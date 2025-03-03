import { auth, db } from './config.js';
import { Auth } from './auth.js';
import { collection, addDoc, doc, getDoc, updateDoc, serverTimestamp, query, orderBy, onSnapshot, increment, deleteDoc, limit, startAfter, getDocs, setDoc, documentId } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { formatPostDate, checkContent, extractHashtags, updateHashtagCount } from './utils.js';
import { SearchWidget } from './search.js';

class App {
    constructor() {
        this.auth = new Auth();
        this.postsPerPage = 10;
        this.lastVisible = null;
        this.isLoading = false;
        this.allPostsLoaded = false;
        this.postCache = new Map(); // Add cache for posts
        this.debounceTimer = null;
        
        // Only initialize feed elements if we're on the home page
        if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
            this.initializeFeed();
        }
        this.setupWelcomeBanner();

        // Initialize search
        new SearchWidget();
    }

    setupWelcomeBanner() {
        const feedContainer = document.getElementById('feedContainer');
        if (!feedContainer) return;

        const banner = document.createElement('div');
        banner.className = 'welcome-banner glass';
        banner.innerHTML = `
            <div class="welcome-content">
                <div class="welcome-text">
                    <h2><i class="ri-flashlight-line"></i> Join the Nova Buzz Community</h2>
                    <p>Share your thoughts, connect with others, and be part of something special.</p>
                </div>
                <div class="welcome-actions">
                    <button class="welcome-btn login-action">
                        <i class="ri-login-circle-line"></i> Login
                    </button>
                    <button class="welcome-btn primary signup-action">
                        <i class="ri-user-add-line"></i> Sign Up
                    </button>
                </div>
            </div>
            <div class="decoration-pattern"></div>
        `;

        feedContainer.parentNode.insertBefore(banner, feedContainer);

        banner.querySelector('.login-action').addEventListener('click', () => {
            this.auth.showLoginForm();
        });

        banner.querySelector('.signup-action').addEventListener('click', () => {
            this.auth.showSignupForm();
        });

        // Show/hide banner based on auth state
        auth.onAuthStateChanged(user => {
            banner.style.display = user ? 'none' : 'block';
        });
    }

    initializeFeed() {
        this.postsContainer = document.getElementById('posts');
        
        // Replace post form with compact version
        const postForm = document.querySelector('.post-form');
        if (postForm) {
            postForm.innerHTML = `
                <div class="compact-post-form">
                    <div class="compact-post-input">
                        <i class="ri-chat-new-line"></i>
                        <span>Share your thoughts...</span>
                    </div>
                </div>
            `;

            const compactForm = postForm.querySelector('.compact-post-form');
            compactForm.addEventListener('click', () => {
                if (auth.currentUser) {
                    this.showPostCreationModal();
                } else {
                    this.auth.showLoginForm();
                }
            });
        }

        if (this.postsContainer) {
            this.setupRealtimeUpdates();
            this.addScrollListener();
            this.showLoadingState();
        }
    }

    showPostCreationModal() {
        const user = auth.currentUser;
        if (!user) {
            this.auth.showLoginForm();
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'create-post-modal';
        modal.innerHTML = `
            <div class="modal-header">
                <h3 class="modal-title">Create Post</h3>
                <button class="close-btn">
                    <i class="ri-close-line"></i>
                </button>
            </div>
            <div class="post-form">
                <textarea id="modalPostContent" placeholder="What's on your mind?" autofocus></textarea>
                <div class="character-counter"></div>
                <button id="modalSubmitPost" class="form-button">
                    <i class="ri-send-plane-fill"></i> Post
                </button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Setup character counter and other functionality
        const postContent = modal.querySelector('#modalPostContent');
        const submitPost = modal.querySelector('#modalSubmitPost');
        const counterDiv = modal.querySelector('.character-counter');

        // Setup character counter
        const updateCharCount = async () => {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            const isVerified = userDoc.data()?.isVerified;
            const MAX_CHARS = isVerified ? 2000 : 250;
            const remaining = MAX_CHARS - postContent.value.length;
            
            counterDiv.textContent = `${remaining} characters remaining${isVerified ? ' (Verified User)' : ''}`;
            counterDiv.className = `character-counter ${remaining < 0 ? 'error' : ''}`;
            submitPost.disabled = remaining < 0;
        };

        postContent.addEventListener('input', updateCharCount);
        updateCharCount();

        // Close modal handlers
        const closeModal = () => overlay.remove();
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
        modal.querySelector('.close-btn').addEventListener('click', closeModal);

        // Submit handler
        submitPost.addEventListener('click', async () => {
            const content = postContent.value.trim();
            if (!content) return;

            try {
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                const userData = userDoc.data();

                // Extract hashtags before creating post
                const hashtags = extractHashtags(content);

                // Create post with hashtags
                const postData = {
                    content,
                    userId: user.uid,
                    username: userData.username,
                    profilePicUrl: userData.profilePicUrl || null,
                    isVerified: userData.isVerified || false,
                    createdAt: serverTimestamp(),
                    likes: 0,
                    truncated: content.length > 150,
                    hashtags: hashtags // Add hashtags to post
                };

                const postRef = await addDoc(collection(db, 'posts'), postData);

                // Update hashtag counts
                await Promise.all(hashtags.map(tag => updateHashtagCount(db, tag)));

                closeModal();
            } catch (error) {
                console.error('Error creating post:', error);
                alert('Error creating post: ' + error.message);
            }
        });

        // Focus textarea
        postContent.focus();
    }

    showLoadingState() {
        const loader = document.createElement('div');
        loader.className = 'loader';
        loader.innerHTML = '<div class="spinner"></div>';
        this.postsContainer.appendChild(loader);
    }

    setupEventListeners() {
        this.submitPost.addEventListener('click', () => this.createPost());
    }

    async setupRealtimeUpdates() {
        const q = query(
            collection(db, 'posts'),
            orderBy('createdAt', 'desc'),
            limit(this.postsPerPage)
        );

        onSnapshot(q, async (snapshot) => {
            this.lastVisible = snapshot.docs[snapshot.docs.length - 1];
            this.removeLoader();
            
            // Get current user's likes
            const userId = auth.currentUser?.uid;
            const likedPosts = userId ? await this.getUserLikedPosts(userId) : new Set();
            
            requestAnimationFrame(() => {
                const fragment = document.createDocumentFragment();
                
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added' && !this.postCache.has(change.doc.id)) {
                        const postData = change.doc.data();
                        postData.hasLiked = likedPosts.has(change.doc.id);
                        const postElement = this.createPostElement(postData, change.doc.id);
                        this.postCache.set(change.doc.id, postElement);
                        fragment.insertBefore(postElement, fragment.firstChild);
                    }
                });

                if (this.postsContainer.firstChild) {
                    this.postsContainer.insertBefore(fragment, this.postsContainer.firstChild);
                } else {
                    this.postsContainer.appendChild(fragment);
                }
            });
        });
    }

    addScrollListener() {
        const options = {
            root: null,
            rootMargin: '100px',
            threshold: 0.1
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    // Debounce scroll handler
                    clearTimeout(this.debounceTimer);
                    this.debounceTimer = setTimeout(() => {
                        if (!this.isLoading && !this.allPostsLoaded) {
                            this.loadMorePosts();
                        }
                    }, 150);
                }
            });
        }, options);

        // Add sentinel element for infinite scroll
        const sentinel = document.createElement('div');
        sentinel.className = 'sentinel';
        this.postsContainer.appendChild(sentinel);
        observer.observe(sentinel);
    }

    async loadMorePosts() {
        if (this.isLoading || this.allPostsLoaded) return;

        this.isLoading = true;
        this.showLoadingState();

        try {
            const q = query(
                collection(db, 'posts'),
                orderBy('createdAt', 'desc'),
                startAfter(this.lastVisible),
                limit(this.postsPerPage)
            );

            const snapshot = await getDocs(q);
            
            if (snapshot.empty) {
                this.allPostsLoaded = true;
                this.removeLoader();
                return;
            }

            this.lastVisible = snapshot.docs[snapshot.docs.length - 1];
            
            snapshot.forEach(doc => {
                this.displayPost(doc.data(), doc.id);
            });
        } catch (error) {
            console.error('Error loading more posts:', error);
        } finally {
            this.isLoading = false;
            this.removeLoader();
        }
    }

    removeLoader() {
        const loader = this.postsContainer.querySelector('.loader');
        if (loader) {
            loader.remove();
        }
    }

    setupCharacterCounter() {
        const counterDiv = document.createElement('div');
        counterDiv.className = 'character-counter';
        this.postContent.parentNode.insertBefore(counterDiv, this.submitPost);

        this.postContent.addEventListener('input', async () => {
            const user = auth.currentUser;
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            const isVerified = userDoc.data()?.isVerified;
            const MAX_CHARS = isVerified ? 2000 : 250;

            const remaining = MAX_CHARS - this.postContent.value.length;
            counterDiv.textContent = `${remaining} characters remaining${isVerified ? ' (Verified User)' : ''}`;
            
            if (remaining < 0) {
                counterDiv.classList.add('error');
                this.submitPost.disabled = true;
            } else {
                counterDiv.classList.remove('error');
                this.submitPost.disabled = false;
            }
        });

        // Update paste handler for new limits
        this.postContent.addEventListener('paste', async (e) => {
            const user = auth.currentUser;
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            const isVerified = userDoc.data()?.isVerified;
            const MAX_CHARS = isVerified ? 2000 : 250;

            const paste = (e.clipboardData || window.clipboardData).getData('text');
            if (paste.length + this.postContent.value.length > MAX_CHARS) {
                e.preventDefault();
                alert(`Pasted content would exceed ${MAX_CHARS} characters limit`);
            }
        });
    }

    async checkUserStatus(userId) {
        const userDoc = await getDoc(doc(db, 'users', userId));
        const userData = userDoc.data();
        
        if (userData.isBanned) {
            throw new Error('Your account has been banned. Contact support for more information.');
        }
        
        if (userData.strikes >= 3) {
            // Ensure ban is applied if it wasn't already
            await updateDoc(doc(db, 'users', userId), {
                isBanned: true,
                banReason: 'Automatic ban: Received 3 strikes',
                bannedAt: serverTimestamp(),
                autoban: true
            });
            throw new Error('Your account has been banned due to receiving 3 strikes.');
        }
        
        return userData;
    }

    async createPost() {
        const content = this.postContent.value.trim();
        if (!content) return;

        try {
            const user = auth.currentUser;
            if (!user) {
                alert('You must be logged in to post');
                return;
            }

            // Check user status before allowing post
            const userData = await this.checkUserStatus(user.uid);
            await checkContent(content, 'post');

            const userDoc = await getDoc(doc(db, 'users', user.uid));
            const isVerified = userDoc.data()?.isVerified;
            const MAX_CHARS = isVerified ? 2000 : 250;

            if (content.length > MAX_CHARS) {
                alert(`Post cannot exceed ${MAX_CHARS} characters${isVerified ? ' (Verified User)' : ''}`);
                return;
            }

            if (!userDoc.exists()) {
                alert('User profile not found');
                return;
            }

            if (!userData.username) {
                alert('Username not found in profile');
                return;
            }

            // Extract hashtags before creating post
            const hashtags = extractHashtags(content);

            // Create post with hashtags
            const postData = {
                content,
                userId: user.uid,
                username: userData.username,
                profilePicUrl: userData.profilePicUrl || null,
                isVerified: userData.isVerified || false,
                createdAt: serverTimestamp(),
                likes: 0,
                truncated: content.length > 150,
                hashtags: hashtags // Add hashtags to post
            };

            const postRef = await addDoc(collection(db, 'posts'), postData);

            // Update hashtag counts
            await Promise.all(hashtags.map(tag => updateHashtagCount(db, tag)));

            this.postContent.value = '';
        } catch (error) {
            alert(error.message);
            return;
        }
    }

    canModifyPost(post) {
        if (!auth.currentUser || post.userId !== auth.currentUser.uid) return false;
        if (post.isVerified) return true;
        
        const postTime = post.createdAt.toDate();
        const timeDiff = (Date.now() - postTime.getTime()) / 1000 / 60; // minutes
        return timeDiff <= 30;
    }

    displayPost(post, postId) {
        const postElement = document.createElement('div');
        postElement.className = 'post';
        
        const dateString = post.createdAt && typeof post.createdAt.toDate === 'function' 
            ? new Date(post.createdAt.toDate()).toLocaleString()
            : 'Just now';

        const displayContent = post.truncated ? 
            post.content.substring(0, 150) + '... ' : 
            post.content;

        const canModify = this.canModifyPost(post);

        postElement.innerHTML = `
            <div class="post-content-wrapper" onclick="window.location.href='post.html?id=${postId}'">
                <div class="post-header">
                    <div class="post-author">
                        <a href="profile.html?uid=${post.userId}" class="author-info" onclick="event.stopPropagation()">
                            <div class="author-avatar">
                                ${post.profilePicUrl ? 
                                    `<img src="${post.profilePicUrl}" alt="${post.username}">` :
                                    `<i class="ri-user-fill"></i>`}
                            </div>
                            <div class="author-name">
                                <strong>${post.username}</strong>
                                ${post.isVerified ? 
                                    `<span class="verified-badge" title="Verified Account">
                                        <i class="ri-verified-badge-fill"></i>
                                    </span>` : 
                                    ''}
                            </div>
                        </a>
                    </div>
                    <span>${dateString}</span>
                </div>
                <div class="post-content">
                    <div class="post-text" ${canModify ? 'contenteditable="true"' : ''}>
                        ${displayContent}
                    </div>
                    ${post.truncated ? '<span class="read-more">Read More</span>' : ''}
                    ${post.edited ? '<span class="edited-tag">(edited)</span>' : ''}
                </div>
            </div>
            <div class="post-actions">
                ${canModify ? `
                    <div class="post-edit-actions">
                        <button class="save-edit-btn" style="display: none;">
                            <i class="ri-save-line"></i> Save
                        </button>
                        <button class="cancel-edit-btn" style="display: none;">
                            <i class="ri-close-line"></i> Cancel
                        </button>
                        <button class="delete-post-btn">
                            <i class="ri-delete-bin-line"></i> Delete
                        </button>
                    </div>
                ` : ''}
                <button class="like-btn" data-post-id="${postId}">
                    <i class="ri-heart-3-line"></i> ${post.likes || 0}
                </button>
                <a href="post.html?id=${postId}" class="view-discussion">
                    <i class="ri-chat-1-line"></i> View Discussion
                </a>
            </div>
        `;

        // Setup edit functionality
        if (canModify) {
            const postText = postElement.querySelector('.post-text');
            const saveBtn = postElement.querySelector('.save-edit-btn');
            const cancelBtn = postElement.querySelector('.cancel-edit-btn');
            const deleteBtn = postElement.querySelector('.delete-post-btn');
            let originalContent = post.content;

            postText.addEventListener('input', () => {
                saveBtn.style.display = 'inline-block';
                cancelBtn.style.display = 'inline-block';
            });

            postText.addEventListener('click', (e) => e.stopPropagation());

            saveBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newContent = postText.innerText.trim();
                if (newContent !== originalContent) {
                    await this.updatePost(postId, newContent);
                }
                saveBtn.style.display = 'none';
                cancelBtn.style.display = 'none';
            });

            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                postText.innerText = originalContent;
                saveBtn.style.display = 'none';
                cancelBtn.style.display = 'none';
            });

            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to delete this post?')) {
                    await this.deletePost(postId);
                }
            });
        }

        // Prevent like button from triggering post click
        const likeBtn = postElement.querySelector('.like-btn');
        likeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.likePost(postId);
        });

        // Add lazy loading for images
        const img = postElement.querySelector('.author-avatar img');
        if (img) {
            img.loading = 'lazy';
            img.decoding = 'async';
        }

        this.postsContainer.insertBefore(postElement, this.postsContainer.firstChild);
    }

    createPostElement(post, postId) {
        const postElement = document.createElement('div');
        postElement.className = 'post';
        postElement.setAttribute('data-post-id', postId);
        
        const dateString = formatPostDate(post.createdAt);
        const displayContent = post.truncated ? 
            post.content.substring(0, 150) + '... ' : 
            post.content;
        const canModify = this.canModifyPost(post);

        postElement.innerHTML = `
            <div class="post-content-wrapper" onclick="window.location.href='post.html?id=${postId}'">
                <div class="post-header">
                    <div class="post-author">
                        <a href="profile.html?uid=${post.userId}" class="author-info" onclick="event.stopPropagation()">
                            <div class="author-avatar">
                                ${post.profilePicUrl ? 
                                    `<img src="${post.profilePicUrl}" alt="${post.displayName || post.username}">` :
                                    `<i class="ri-user-fill"></i>`}
                            </div>
                            <div class="author-name">
                                <strong>${post.displayName || post.username}</strong>
                                <small>@${post.username}</small>
                                ${post.isVerified ? 
                                    `<span class="verified-badge" title="Verified Account">
                                        <i class="ri-verified-badge-fill"></i>
                                    </span>` : 
                                    ''}
                            </div>
                        </a>
                    </div>
                    <span>${dateString}</span>
                </div>
                <div class="post-content">
                    <div class="post-text" ${canModify ? 'contenteditable="true"' : ''}>
                        ${displayContent}
                    </div>
                    ${post.truncated ? '<span class="read-more">Read More</span>' : ''}
                    ${post.edited ? '<span class="edited-tag">(edited)</span>' : ''}
                </div>
            </div>
            <div class="post-actions">
                ${canModify ? `
                    <div class="post-edit-actions">
                        <button class="save-edit-btn" style="display: none;">
                            <i class="ri-save-line"></i> Save
                        </button>
                        <button class="cancel-edit-btn" style="display: none;">
                            <i class="ri-close-line"></i> Cancel
                        </button>
                        <button class="delete-post-btn">
                            <i class="ri-delete-bin-line"></i> Delete
                        </button>
                    </div>
                ` : ''}
                <button class="like-btn ${post.hasLiked ? 'active' : ''}" data-post-id="${postId}">
                    <i class="ri-${post.hasLiked ? 'heart-3-fill' : 'heart-3-line'}"></i> ${post.likes || 0}
                </button>
                <a href="post.html?id=${postId}" class="view-discussion">
                    <i class="ri-chat-1-line"></i> View Discussion
                </a>
            </div>
        `;

        // Setup event listeners
        this.setupPostEventListeners(postElement, post, postId, canModify);

        // Lazy load images
        const img = postElement.querySelector('.author-avatar img');
        if (img) {
            img.loading = 'lazy';
            img.decoding = 'async';
            img.addEventListener('load', () => img.classList.add('loaded'));
        }

        return postElement;
    }

    setupPostEventListeners(postElement, post, postId, canModify) {
        if (canModify) {
            const postText = postElement.querySelector('.post-text');
            const saveBtn = postElement.querySelector('.save-edit-btn');
            const cancelBtn = postElement.querySelector('.cancel-edit-btn');
            const deleteBtn = postElement.querySelector('.delete-post-btn');
            let originalContent = post.content;

            // Use event delegation for better performance
            postElement.addEventListener('click', (e) => {
                const target = e.target;
                if (target.matches('.save-edit-btn')) {
                    e.stopPropagation();
                    this.handleSaveEdit(postId, postText, saveBtn, cancelBtn, originalContent);
                } else if (target.matches('.cancel-edit-btn')) {
                    e.stopPropagation();
                    this.handleCancelEdit(postText, saveBtn, cancelBtn, originalContent);
                } else if (target.matches('.delete-post-btn')) {
                    e.stopPropagation();
                    this.handleDeletePost(postId);
                }
            });

            postText.addEventListener('input', () => {
                requestAnimationFrame(() => {
                    saveBtn.style.display = 'inline-block';
                    cancelBtn.style.display = 'inline-block';
                });
            });
        }

        // Optimize like button handler
        const likeBtn = postElement.querySelector('.like-btn');
        if (likeBtn) {
            likeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleLike(postId, likeBtn);
            });
        }
    }

    async handleLike(postId, likeBtn) {
        if (!auth.currentUser) {
            alert('Please login to like posts');
            return;
        }

        const userId = auth.currentUser.uid;
        const postRef = doc(db, 'posts', postId);
        const likeRef = doc(db, `posts/${postId}/likes`, userId);

        try {
            const likeDoc = await getDoc(likeRef);
            const hasLiked = likeDoc.exists();

            if (hasLiked) {
                // Unlike the post
                await deleteDoc(likeRef);
                await updateDoc(postRef, {
                    likes: increment(-1)
                });
                likeBtn.classList.remove('active');
                likeBtn.querySelector('i').className = 'ri-heart-3-line';
            } else {
                // Like the post
                await setDoc(likeRef, {
                    userId,
                    createdAt: serverTimestamp()
                });
                await updateDoc(postRef, {
                    likes: increment(1)
                });
                likeBtn.classList.add('active');
                likeBtn.querySelector('i').className = 'ri-heart-3-fill';
            }

            // Update like count in UI
            const likesCount = await getDoc(postRef);
            const likesElement = likeBtn.querySelector('i').nextSibling;
            likesElement.textContent = ` ${likesCount.data().likes || 0}`;
        } catch (error) {
            console.error('Error toggling like:', error);
            alert('Error updating like');
        }
    }

    async getUserLikedPosts(userId) {
        const likedPosts = new Set();
        const batch = 10; // Process posts in batches
        let lastPostId = null;

        while (true) {
            let q = query(
                collection(db, 'posts'),
                orderBy(documentId()),
                limit(batch)
            );

            if (lastPostId) {
                q = query(q, startAfter(lastPostId));
            }

            const posts = await getDocs(q);
            if (posts.empty) break;

            const likesPromises = posts.docs.map(post => 
                getDoc(doc(db, `posts/${post.id}/likes`, userId))
            );
            const likesResults = await Promise.all(likesPromises);

            likesResults.forEach((like, index) => {
                if (like.exists()) {
                    likedPosts.add(posts.docs[index].id);
                }
            });

            lastPostId = posts.docs[posts.docs.length - 1].id;
            if (posts.docs.length < batch) break;
        }

        return likedPosts;
    }

    async updatePost(postId, newContent) {
        try {
            const postRef = doc(db, 'posts', postId);
            const postDoc = await getDoc(postRef);
            const oldData = postDoc.data();
            
            // Get old and new hashtags
            const oldTags = oldData.hashtags || [];
            const newTags = extractHashtags(newContent);
            
            // Find tags to remove and add
            const tagsToRemove = oldTags.filter(tag => !newTags.includes(tag));
            const tagsToAdd = newTags.filter(tag => !oldTags.includes(tag));

            // Update post
            await updateDoc(postRef, {
                content: newContent,
                edited: true,
                truncated: newContent.length > 150,
                hashtags: newTags
            });

            // Update hashtag counts
            await Promise.all([
                ...tagsToRemove.map(tag => updateHashtagCount(db, tag, false)),
                ...tagsToAdd.map(tag => updateHashtagCount(db, tag))
            ]);
        } catch (error) {
            alert('Error updating post: ' + error.message);
        }
    }

    async deletePost(postId) {
        try {
            const postRef = doc(db, 'posts', postId);
            const postDoc = await getDoc(postRef);
            const hashtags = postDoc.data().hashtags || [];

            // Delete post
            await deleteDoc(postRef);

            // Update hashtag counts
            await Promise.all(hashtags.map(tag => updateHashtagCount(db, tag, false)));
        } catch (error) {
            alert('Error deleting post: ' + error.message);
        }
    }

    async likePost(postId) {
        try {
            const postRef = doc(db, 'posts', postId);
            await updateDoc(postRef, {
                likes: increment(1)
            });
        } catch (error) {
            alert(error.message);
        }
    }

    async handleSaveEdit(postId, postText, saveBtn, cancelBtn, originalContent) {
        const newContent = postText.innerText.trim();
        if (newContent === originalContent) return;

        try {
            // Check user status before allowing edit
            await this.checkUserStatus(auth.currentUser.uid);
            await checkContent(newContent, 'post');
            await this.updatePost(postId, newContent);
            saveBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
        } catch (error) {
            alert(error.message);
            postText.innerText = originalContent;
        }
    }

    handleCancelEdit(postText, saveBtn, cancelBtn, originalContent) {
        postText.innerText = originalContent;
        saveBtn.style.display = 'none';
        cancelBtn.style.display = 'none';
    }

    handleDeletePost(postId) {
        if (confirm('Are you sure you want to delete this post?')) {
            this.deletePost(postId);
        }
    }

    cleanup() {
        // Clear cache and remove listeners when component unmounts
        this.postCache.clear();
        clearTimeout(this.debounceTimer);
    }
}

// Initialize the app with cleanup
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    window.addEventListener('unload', () => app.cleanup());
});
