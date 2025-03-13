import { auth, db } from './config.js';
import { Auth } from './auth.js';
import { 
    collection, 
    addDoc,
    doc, 
    getDoc, 
    updateDoc, 
    serverTimestamp, 
    query, 
    orderBy, 
    onSnapshot, 
    increment as fbIncrement, // Change increment to fbIncrement to avoid confusion
    deleteDoc,
    limit,
    startAfter,
    getDocs,
    setDoc,
    documentId,
    arrayRemove,
    arrayUnion
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { formatPostDate, checkContent, extractHashtags, updateHashtagCount, getCurrentUserData, textToHtml, setupOfflineListener } from './utils.js';
import { SearchWidget } from './search.js';
import { ThemeManager } from './themeManager.js';
import { NotificationSystem } from './notifications.js';

class App {
    constructor() {
        this.auth = new Auth();
        this.postsPerPage = 10;
        this.lastVisible = null;
        this.isLoading = false;
        this.allPostsLoaded = false;
        this.postCache = new Map(); // Add cache for posts
        this.debounceTimer = null;
        this.drafts = JSON.parse(localStorage.getItem('postDrafts') || '[]');
        this.setupKeyboardShortcuts();
        
        // Only initialize feed elements if we're on the home page
        if (window.location.pathname.endsWith('home.html') || window.location.pathname === '/') {
            this.initializeFeed();
        }
        this.setupWelcomeBanner();

        // Initialize search
        new SearchWidget();

        // Initialize theme manager
        new ThemeManager();

        this.setupMobileNav();
        this.offlineCleanup = setupOfflineListener(
            () => this.handleOffline(),
            () => this.handleOnline()
        );
        this.setupErrorHandling();
        this.notifications = new NotificationSystem();
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + / to focus search
            if ((e.ctrlKey || e.metaKey) && e.key === '/') {
                e.preventDefault();
                document.querySelector('.search-input')?.focus();
            }

            // Ctrl/Cmd + P to create new post
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                this.showPostCreationModal();
            }

            // Esc to close modals
            if (e.key === 'Escape') {
                document.querySelector('.modal-overlay')?.remove();
            }
        });
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

        // Define modal content first
        let modalContent = `
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

        // Add formatting help text after checking user verification status
        const setupModal = async () => {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            const isVerified = userDoc.data()?.isVerified;
            
            if (isVerified) {
                modalContent += `
                    <div class="formatting-help">
                        <p>Formatting options:</p>
                        <ul>
                            <li><code>**bold**</code> for <strong>bold</strong></li>
                            <li><code>*italic*</code> for <em>italic</em></li>
                            <li><code>__underline__</code> for <u>underline</u></li>
                            <li><code>~~strike~~</code> for <s>strike</s></li>
                            <li><code>\`code\`</code> for <code>code</code></li>
                        </ul>
                    </div>`;
            }

            modal.innerHTML = modalContent;
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // Setup rest of modal functionality
            const postContent = modal.querySelector('#modalPostContent');
            const submitPost = modal.querySelector('#modalSubmitPost');
            const counterDiv = modal.querySelector('.character-counter');

            // Setup character counter
            const updateCharCount = async () => {
                const remaining = isVerified ? 2000 - postContent.value.length : 250 - postContent.value.length;
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

            // Add drafts dropdown if drafts exist
            if (this.drafts.length > 0) {
                const draftsSelect = document.createElement('select');
                draftsSelect.className = 'drafts-select';
                draftsSelect.innerHTML = `
                    <option value="">Load from drafts...</option>
                    ${this.drafts.map((draft, i) => `
                        <option value="${i}">
                            ${draft.content.substring(0, 30)}...
                            (${new Date(draft.timestamp).toLocaleDateString()})
                        </option>
                    `).join('')}
                `;

                modal.querySelector('.post-form').insertBefore(
                    draftsSelect,
                    modal.querySelector('textarea')
                );

                draftsSelect.addEventListener('change', () => {
                    if (draftsSelect.value !== '') {
                        const draft = this.drafts[draftsSelect.value];
                        postContent.value = draft.content;
                        updateCharCount();
                    }
                });
            }

            // Add save as draft button
            const saveAsDraft = document.createElement('button');
            saveAsDraft.className = 'form-button secondary';
            saveAsDraft.innerHTML = '<i class="ri-draft-line"></i> Save as Draft';
            
            modal.querySelector('.post-form').appendChild(saveAsDraft);

            saveAsDraft.addEventListener('click', () => {
                const content = postContent.value.trim();
                if (!content) return;

                this.drafts.unshift({
                    content,
                    timestamp: Date.now()
                });

                // Keep only last 5 drafts
                this.drafts = this.drafts.slice(0, 5);
                localStorage.setItem('postDrafts', JSON.stringify(this.drafts));
                
                alert('Draft saved!');
            });

            // Submit handler
            submitPost.addEventListener('click', async () => {
                const content = postContent.value.trim();
                if (!content) return;

                try {
                    const userDoc = await getDoc(doc(db, 'users', user.uid));
                    const userData = userDoc.data();

                    // Extract hashtags before creating post
                    const hashtags = extractHashtags(content);

                    // Create post with hashtags and lowercase content
                    const postData = {
                        content: content, // Store raw content
                        contentLower: content.toLowerCase(), // Add lowercase content for better search
                        userId: user.uid,
                        username: userData.username,
                        profilePicUrl: userData.profilePicUrl || null,
                        isVerified: userData.isVerified || false,
                        createdAt: serverTimestamp(),
                        likes: 0,
                        truncated: content.length > 150,
                        hashtags: hashtags.map(tag => tag.toLowerCase()) // Ensure hashtags are lowercase
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

            const isMobile = window.innerWidth <= 768;
            
            if (isMobile) {
                modal.className = 'create-post-modal mobile';
                modal.style.height = '100%';
                modal.style.width = '100%';
            }
        };

        setupModal();
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
            
            // Process changes in batches
            const processChanges = async () => {
                const fragment = document.createDocumentFragment();
                
                for (const change of snapshot.docChanges()) {
                    if (change.type === 'added' && !this.postCache.has(change.doc.id)) {
                        const postData = change.doc.data();
                        postData.hasLiked = likedPosts.has(change.doc.id);
                        const postElement = await this.createPostElement(postData, change.doc.id);
                        if (postElement) {
                            this.postCache.set(change.doc.id, postElement);
                            fragment.insertBefore(postElement, fragment.firstChild);
                        }
                    }
                }

                if (fragment.hasChildNodes()) {
                    if (this.postsContainer.firstChild) {
                        this.postsContainer.insertBefore(fragment, this.postsContainer.firstChild);
                    } else {
                        this.postsContainer.appendChild(fragment);
                    }
                }
            };

            // Use requestAnimationFrame to handle UI updates
            requestAnimationFrame(async () => {
                try {
                    await processChanges();
                } catch (error) {
                    console.error('Error processing post changes:', error);
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

    async createPost(postData) {
        let content;
        let quotedPostId;

        // Handle both string and object inputs
        if (typeof postData === 'string') {
            content = postData;
        } else {
            content = postData.content;
            quotedPostId = postData.quotedPostId;
        }

        if (!content) return;

        try {
            const user = auth.currentUser;
            if (!user) {
                alert('You must be logged in to post');
                return;
            }

            // Check user status before allowing post
            const userData = await this.checkUserStatus(user.uid);
            
            // For quote posts, only check content after the quote
            const actualContent = quotedPostId ? 
                content.split('\n\n').slice(1).join('\n\n') : 
                content;

            await checkContent(actualContent, 'post');

            const userDoc = await getDoc(doc(db, 'users', user.uid));
            const isVerified = userDoc.data()?.isVerified;
            const MAX_CHARS = isVerified ? 2000 : 250;

            // Only count non-quoted content toward character limit
            if (actualContent.length > MAX_CHARS) {
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
            const postDataToSave = {
                content: content, // Store raw content
                contentLower: content.toLowerCase(),
                userId: user.uid,
                username: userData.username,
                profilePicUrl: userData.profilePicUrl || null,
                isVerified: userData.isVerified || false,
                createdAt: serverTimestamp(),
                likes: 0,
                truncated: content.length > 150,
                hashtags: hashtags // Add hashtags to post
            };

            if (quotedPostId) {
                postDataToSave.quotedPost = {
                    id: quotedPostId,
                    username: postData.quotedUsername,
                    content: postData.quotedContent
                };
            }

            const postRef = await addDoc(collection(db, 'posts'), postDataToSave);

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
        
        // Add null check for createdAt
        if (!post.createdAt) return false;
        
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
            textToHtml(post.content.substring(0, 150) + '...', post.isVerified) : 
            textToHtml(post.content, post.isVerified);

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
                <button class="quick-action-btn reply-btn" data-post-id="${postId}">
                    <i class="ri-reply-line"></i> Reply
                </button>
                <button class="quick-action-btn quote-btn" data-post-id="${postId}">
                    <i class="ri-double-quotes-l"></i> Quote
                </button>
                <a href="post.html?id=${postId}" class="view-discussion">
                    <i class="ri-chat-1-line"></i> View Discussion
                </a>
            </div>
            <div class="quick-reply-form" id="reply-form-${postId}">
                <textarea placeholder="Write your reply..."></textarea>
                <div class="button-group">
                    <button class="form-button submit-reply">Reply</button>
                    <button class="form-button secondary cancel-reply">Cancel</button>
                </div>
            </div>`;

        // Add event listeners for reply and quote
        const replyBtn = postElement.querySelector('.reply-btn');
        const quoteBtn = postElement.querySelector('.quote-btn');
        const replyForm = postElement.querySelector('.quick-reply-form');
        
        replyBtn.addEventListener('click', () => {
            replyForm.classList.toggle('active');
            const textarea = replyForm.querySelector('textarea');
            textarea.focus();
        });

        quoteBtn.addEventListener('click', () => {
            replyForm.classList.add('active');
            const textarea = replyForm.querySelector('textarea');
            const quotedContent = `<div class="quoted-content">
                <div class="quoted-author">@${post.username}</div>
                ${post.content}
            </div>\n\n`;
            textarea.value = quotedContent;
            textarea.focus();
        });

        const cancelReply = replyForm.querySelector('.cancel-reply');
        cancelReply.addEventListener('click', () => {
            replyForm.classList.remove('active');
            replyForm.querySelector('textarea').value = '';
        });

        const submitReply = replyForm.querySelector('.submit-reply');
        submitReply.addEventListener('click', async () => {
            const content = replyForm.querySelector('textarea').value.trim();
            if (!content) return;

            try {
                await this.createComment(postId, content);
                replyForm.classList.remove('active');
                replyForm.querySelector('textarea').value = '';
            } catch (error) {
                alert(error.message);
            }
        });

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

    async createPostElement(post, postId) {
        const postElement = document.createElement('div');
        postElement.className = 'post';
        postElement.setAttribute('data-post-id', postId);
        
        // Get current user data to ensure up-to-date information
        const currentUserData = await getCurrentUserData(db, post.userId);
        const username = currentUserData?.username || post.username;
        const displayName = currentUserData?.displayName || username;
        const profilePicUrl = currentUserData?.profilePicUrl || post.profilePicUrl;
        const isVerified = currentUserData?.isVerified || false;
        
        const dateString = formatPostDate(post.createdAt);
        const canModify = this.canModifyPost(post);

        const isAuthor = auth.currentUser?.uid === post.userId;
        const canEdit = this.canEditPost(post);
        
        // Handle quoted content display
        let displayContent = '';
        if (post.quotedPost) {
            displayContent = `
                <div class="quoted-content" data-post-id="${post.quotedPost.id}">
                    <div class="quoted-author">@${post.quotedPost.username}</div>
                    <div class="quoted-text">${textToHtml(post.quotedPost.content, false)}</div>
                </div>
                <div class="post-text" ${canModify ? 'contenteditable="true"' : ''}>
                    ${textToHtml(post.content, isVerified)}
                </div>
            `;
        } else {
            displayContent = `
                <div class="post-text" ${canModify ? 'contenteditable="true"' : ''}>
                    ${textToHtml(post.content, isVerified)}
                </div>
            `;
        }

        postElement.innerHTML = `
            <div class="post-content-wrapper" onclick="window.location.href='post.html?id=${postId}'">
                ${post.isPinned ? `
                    <div class="post-pinned-badge">
                        <i class="ri-pushpin-fill"></i> Pinned
                    </div>` : ''}
                <div class="post-header">
                    <div class="post-author">
                        <a href="profile.html?uid=${post.userId}" class="author-info" onclick="event.stopPropagation()">
                            <div class="author-avatar">
                                ${profilePicUrl ? 
                                    `<img src="${profilePicUrl}" alt="${displayName}">` :
                                    `<i class="ri-user-fill"></i>`}
                            </div>
                            <div class="author-name">
                                <strong>${displayName}</strong>
                                <small>@${username}</small>
                                ${isVerified ? 
                                    `<span class="verified-badge" title="Verified Account">
                                        <i class="ri-verified-badge-fill"></i>
                                    </span>` : 
                                    ''}
                            </div>
                        </a>
                    </div>
                    <span>${dateString}</span>
                    ${isAuthor ? `
                        <button class="post-menu-btn">
                            <i class="ri-more-2-fill"></i>
                        </button>
                    ` : ''}
                </div>
                <div class="post-content">
                    ${displayContent}
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
                <button class="quick-action-btn reply-btn" data-post-id="${postId}">
                    <i class="ri-reply-line"></i> Reply
                </button>
                <button class="quick-action-btn quote-btn" data-post-id="${postId}">
                    <i class="ri-double-quotes-l"></i> Quote
                </button>
                <a href="post.html?id=${postId}" class="view-discussion">
                    <i class="ri-chat-1-line"></i> View Discussion
                </a>
            </div>
            <div class="quick-reply-form" id="reply-form-${postId}">
                <textarea placeholder="Write your reply..."></textarea>
                <div class="button-group">
                    <button class="form-button submit-reply">Reply</button>
                    <button class="form-button secondary cancel-reply">Cancel</button>
                </div>
            </div>`;

        if (isAuthor) {
            const menuBtn = postElement.querySelector('.post-menu-btn');
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showPostMenu(post, postId, menuBtn);
            });
        }

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

    showPostMenu(post, postId, menuBtn) {
        // Remove any existing menus
        document.querySelectorAll('.post-context-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'post-context-menu';
        
        const canEdit = this.canEditPost(post);
        
        menu.innerHTML = `
            ${canEdit ? `
                <div class="menu-item edit-post">
                    <i class="ri-edit-line"></i> Edit
                </div>
            ` : `
                <div class="menu-item disabled" title="Edit time expired">
                    <i class="ri-edit-line"></i> Edit
                </div>
            `}
            <div class="menu-item ${post.isPinned ? 'unpin-post' : 'pin-post'}">
                <i class="ri-pushpin-${post.isPinned ? 'fill' : 'line'}"></i>
                ${post.isPinned ? 'Unpin' : 'Pin to Profile'}
            </div>
            <div class="menu-item danger delete-post">
                <i class="ri-delete-bin-line"></i> Delete
            </div>
        `;

        if (window.innerWidth <= 768) {
            menu.className = 'post-context-menu mobile';
            document.body.appendChild(menu);
        } else {
            menuBtn.parentElement.appendChild(menu);
        }

        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !menuBtn.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        
        setTimeout(() => document.addEventListener('click', closeMenu), 0);

        // Setup menu actions
        if (canEdit) {
            menu.querySelector('.edit-post')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.startEditing(post, postId);
                menu.remove();
            });
        }

        menu.querySelector('.pin-post, .unpin-post')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePin(post, postId);
            menu.remove();
        });

        menu.querySelector('.delete-post')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleDeletePost(postId);
            menu.remove();
        });
    }

    canEditPost(post) {
        if (!auth.currentUser || post.userId !== auth.currentUser.uid) return false;
        if (post.isVerified) return true;
        
        // Add null check for createdAt and timestamp
        if (!post.createdAt || typeof post.createdAt.toDate !== 'function') return false;
        
        const postTime = post.createdAt.toDate();
        const timeDiff = (Date.now() - postTime.getTime()) / 1000 / 60;
        return timeDiff <= 10;
    }

    async togglePin(post, postId) {
        try {
            const userRef = doc(db, 'users', auth.currentUser.uid);
            const postRef = doc(db, 'posts', postId);

            if (post.isPinned) {
                await updateDoc(postRef, { isPinned: false });
                await updateDoc(userRef, { 
                    pinnedPosts: arrayRemove(postId)
                });
            } else {
                await updateDoc(postRef, { isPinned: true });
                await updateDoc(userRef, { 
                    pinnedPosts: arrayUnion(postId)
                });
            }
        } catch (error) {
            console.error('Error toggling pin:', error);
            alert('Error updating post');
        }
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

        // Add reply button handler
        const replyBtn = postElement.querySelector('.reply-btn');
        const quoteBtn = postElement.querySelector('.quote-btn');
        const replyForm = postElement.querySelector('.quick-reply-form');

        if (replyBtn && replyForm) {
            replyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleReply(replyForm);
            });
        }

        if (quoteBtn && replyForm) {
            quoteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleQuote(replyForm, post, postId); // Pass postId to handleQuote
            });
        }

        // Add submit and cancel handlers for reply form
        const submitReply = replyForm?.querySelector('.submit-reply');
        const cancelReply = replyForm?.querySelector('.cancel-reply');

        submitReply?.addEventListener('click', async () => {
            const content = replyForm.querySelector('textarea').value.trim();
            if (!content) return;

            try {
                await this.createComment(postId, content);
                replyForm.classList.remove('active');
                replyForm.querySelector('textarea').value = '';
            } catch (error) {
                alert(error.message);
            }
        });

        cancelReply?.addEventListener('click', () => {
            replyForm.classList.remove('active');
            replyForm.querySelector('textarea').value = '';
        });
    }

    handleReply(replyForm) {
        if (!auth.currentUser) {
            this.auth.showLoginForm();
            return;
        }
        replyForm.classList.add('active');
        replyForm.querySelector('textarea').focus();
    }

    handleQuote(replyForm, post, postId) { // Add postId parameter
        if (!auth.currentUser) {
            this.auth.showLoginForm();
            return;
        }

        // Improved quote formatting
        const truncatedQuote = post.content.length > 200 ? 
            post.content.substring(0, 200) + '...' : 
            post.content;

        const modal = document.createElement('div');
        modal.className = 'create-post-modal';
        modal.innerHTML = `
            <div class="modal-header">
                <h3 class="modal-title">Quote Post</h3>
                <button class="close-btn">
                    <i class="ri-close-line"></i>
                </button>
            </div>
            <div class="post-form">
                <div class="quoted-content-preview">
                    <div class="quoted-author">@${post.username}</div>
                    <div class="quoted-text">${textToHtml(truncatedQuote, post.isVerified)}</div>
                </div>
                <textarea id="modalPostContent" placeholder="Add your thoughts..." autofocus></textarea>
                <div class="character-counter"></div>
                <button id="modalSubmitPost" class="form-button">
                    <i class="ri-send-plane-fill"></i> Post
                </button>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Make quoted content clickable
        const quotedDiv = modal.querySelector('.quoted-content');
        quotedDiv.addEventListener('click', () => {
            window.location.href = `post.html?id=${postId}`;
        });

        // Setup modal functionality
        const postContent = modal.querySelector('#modalPostContent');
        const submitPost = modal.querySelector('#modalSubmitPost');
        const counterDiv = modal.querySelector('.character-counter');
        const closeBtn = modal.querySelector('.close-btn');

        // Close modal handlers
        const closeModal = () => overlay.remove();
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
        closeBtn.addEventListener('click', closeModal);

        submitPost.addEventListener('click', async () => {
            const content = postContent.value.trim();
            if (!content) return;

            try {
                const postData = {
                    content,
                    quotedPostId: postId,
                    quotedUsername: post.username,
                    quotedContent: truncatedQuote
                };
                await this.createPost(postData);
                closeModal();
            } catch (error) {
                alert('Error creating post: ' + error.message);
            }
        });

        // Add character counter that excludes quoted content
        const updateCharCount = () => {
            const length = postContent.value.length;
            counterDiv.textContent = `${length} characters`;
            submitPost.disabled = length === 0;
        };
        postContent.addEventListener('input', updateCharCount);
        updateCharCount();
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
                    likes: fbIncrement(-1) // Use fbIncrement instead of increment
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
                    likes: fbIncrement(1) // Use fbIncrement instead of increment
                });
                likeBtn.classList.add('active');
                likeBtn.querySelector('i').className = 'ri-heart-3-fill';
            }

            // Update like count in UI
            const likesCount = await getDoc(postRef);
            const likesElement = likeBtn.querySelector('i').nextSibling;
            likesElement.textContent = ` ${likesCount.data().likes || 0}`;

            // Add notification after successful like
            const postDoc = await getDoc(postRef);
            const post = postDoc.data();

            await this.notifications.createNotification({
                type: 'like',
                recipientId: post.userId,
                senderId: auth.currentUser.uid,
                message: `${auth.currentUser.displayName || 'Someone'} liked your post`,
                postId
            });
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
                likes: fbIncrement(1) // Use fbIncrement instead of increment
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

    async createComment(postId, content) {
        if (!auth.currentUser) {
            throw new Error('Please login to comment');
        }

        await checkContent(content, 'comment');
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        const userData = userDoc.data();

        await addDoc(collection(db, 'posts', postId, 'comments'), {
            content,
            userId: auth.currentUser.uid,
            username: userData.username,
            createdAt: serverTimestamp()
        });

        // Add notification
        const postRef = doc(db, 'posts', postId);
        const postDoc = await getDoc(postRef);
        const post = postDoc.data();

        await this.notifications.createNotification({
            type: 'comment',
            recipientId: post.userId,
            senderId: auth.currentUser.uid,
            message: `${auth.currentUser.displayName || 'Someone'} commented on your post`,
            postId
        });

        // Check for mentions and notify
        const mentions = content.match(/@(\w+)/g) || [];
        for (const mention of mentions) {
            const username = mention.slice(1);
            const userQuery = query(collection(db, 'users'), 
                where('usernameLower', '==', username.toLowerCase()));
            const userSnapshot = await getDocs(userQuery);
            
            if (!userSnapshot.empty) {
                const mentionedUser = userSnapshot.docs[0];
                await this.notifications.createNotification({
                    type: 'mention',
                    recipientId: mentionedUser.id,
                    senderId: auth.currentUser.uid,
                    message: `${auth.currentUser.displayName || 'Someone'} mentioned you in a comment`,
                    postId
                });
            }
        }
    }

    cleanup() {
        // Clear cache and remove listeners when component unmounts
        this.postCache.clear();
        clearTimeout(this.debounceTimer);
        this.offlineCleanup();
    }

    setupMobileNav() {
        if (document.querySelector('.mobile-nav')) return; // Don't add if already exists

        const nav = document.createElement('nav');
        nav.className = 'mobile-nav';
        nav.style.display = window.innerWidth <= 768 ? 'flex' : 'none';

        const currentPage = window.location.pathname.split('/').pop() || 'home.html';

        nav.innerHTML = `
            <a href="home.html" class="mobile-nav-item ${currentPage === 'home.html' ? 'active' : ''}">
                <i class="ri-home-5-line"></i>
                <span>Home</span>
            </a>
            <a href="search.html" class="mobile-nav-item ${currentPage === 'search.html' ? 'active' : ''}">
                <i class="ri-search-line"></i>
                <span>Search</span>
            </a>
            <button class="mobile-nav-item" id="mobileNewPost">
                <i class="ri-add-circle-line"></i>
                <span>Post</span>
            </button>
            <a href="profile.html" class="mobile-nav-item ${currentPage === 'profile.html' ? 'active' : ''}">
                <i class="ri-user-3-line"></i>
                <span>Profile</span>
            </a>
            <a href="settings.html" class="mobile-nav-item ${currentPage === 'settings.html' ? 'active' : ''}">
                <i class="ri-settings-4-line"></i>
                <span>More</span>
            </a>
        `;

        document.body.appendChild(nav);

        // New post button handler
        nav.querySelector('#mobileNewPost').addEventListener('click', () => {
            if (auth.currentUser) {
                this.showPostCreationModal();
            } else {
                this.auth.showLoginForm();
            }
        });

        // Update nav visibility on resize
        window.addEventListener('resize', () => {
            nav.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
        });
    }

    setupErrorHandling() {
        window.onerror = (msg, url, line, col, error) => {
            console.error('Global error:', { msg, url, line, col, error });
            this.showErrorNotification('An error occurred. Please refresh the page.');
        };

        window.onunhandledrejection = (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            this.showErrorNotification('Failed to complete action. Please try again.');
        };
    }

    startEditing(post, postId) {
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (!postElement) return;

        const postText = postElement.querySelector('.post-text');
        const saveBtn = postElement.querySelector('.save-edit-btn');
        const cancelBtn = postElement.querySelector('.cancel-edit-btn');

        postText.contentEditable = true;
        postText.focus();
        saveBtn.style.display = 'inline-block';
        cancelBtn.style.display = 'inline-block';

        // Place cursor at end
        const range = document.createRange();
        range.selectNodeContents(postText);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    async handleOffline() {
        document.body.classList.add('offline');
        this.notifications.showNotification({
            type: 'warning',
            message: 'You are currently offline'
        });
    }

    async handleOnline() {
        document.body.classList.remove('offline');
        this.notifications.showNotification({
            type: 'success', 
            message: 'Back online!'
        });
        await this.syncOfflineActions();
    }

    showErrorNotification(message, type = 'error') {
        this.notifications.showNotification({
            type,
            message
        });
    }
}

// Initialize the app with cleanup
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    window.addEventListener('unload', () => app.cleanup());
});
