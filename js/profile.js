import { auth, db } from './config.js';
import { 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    orderBy, 
    onSnapshot, 
    updateDoc, 
    limit,
    startAfter,
    getDocs
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { formatPostDate } from './utils.js';
import { AdminPanel } from './admin.js';
import { EmbedGenerator } from './embeds.js';

class Profile {
    constructor() {
        this.postsPerPage = 10;
        this.lastVisible = null;
        this.isLoading = false;
        this.allPostsLoaded = false;
        this.setupUI();
        this.setupListeners();

        // Add error handling for missing elements
        if (!this.profileUsername || !this.profileJoinDate || !this.userPosts) {
            console.error('Required profile elements not found');
            return;
        }
        
        // Check for user ID in URL
        const urlParams = new URLSearchParams(window.location.search);
        this.urlUserId = urlParams.get('uid');

        new AdminPanel();
    }

    setupUI() {
        this.profileUsername = document.getElementById('profileUsername');
        this.profileJoinDate = document.getElementById('profileJoinDate');
        this.postsCount = document.getElementById('postsCount');
        this.likesCount = document.getElementById('likesCount');
        this.userPosts = document.getElementById('userPosts');
        this.editProfileBtn = document.getElementById('editProfileBtn');
        this.profileInfo = document.querySelector('.profile-info'); // Add this line
        this.profileAvatar = document.querySelector('.profile-avatar');
        
        // Add click handler for profile picture upload
        if (this.profileAvatar) {
            this.profileAvatar.addEventListener('click', () => {
                if (auth.currentUser?.uid === this.urlUserId || !this.urlUserId) {
                    this.handleProfilePictureUpload();
                }
            });
        }

        // Add error handling for missing elements
        if (!this.profileInfo) {
            console.error('Profile info element not found');
            return;
        }

        this.addScrollListener();
    }

    setupListeners() {
        auth.onAuthStateChanged(user => {
            if (user) {
                // Load profile based on URL parameter or current user
                const profileUserId = this.urlUserId || user.uid;
                this.loadProfileData(profileUserId);
                this.loadUserPosts(profileUserId);
                
                // Only show edit button if viewing own profile
                if (this.editProfileBtn) {
                    this.editProfileBtn.style.display = 
                        profileUserId === user.uid ? 'block' : 'none';
                }
            } else if (!this.urlUserId) {
                // Only redirect if not viewing someone else's profile
                window.location.href = 'home.html';
            }
        });

        if (this.editProfileBtn) {
            this.editProfileBtn.addEventListener('click', () => this.showEditProfileForm());
        }
    }

    async loadProfileData(userId) {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            
            // Update meta tags for SEO and social sharing
            const embedData = EmbedGenerator.generateProfileEmbed(userData, userId);
            EmbedGenerator.updateMetaTags(embedData);

            // Generate oEmbed JSON
            this.generateOembedJson(userData);

            // Update profile picture
            this.updateProfilePicture(userData.profilePicUrl);

            // Update profile info with display name and username
            this.profileUsername.innerHTML = `
                <div class="profile-name">
                    <h1>${userData.displayName || userData.username}</h1>
                    <span class="profile-username">@${userData.username}</span>
                    ${userData.isVerified ? 
                        `<span class="verified-badge" title="Verified Account">
                            <i class="ri-verified-badge-fill"></i>
                        </span>` : 
                        ''}
                </div>
            `;
            this.profileJoinDate.textContent = `Member since: ${new Date(userData.createdAt.toDate()).toLocaleDateString()}`;
            
            // Remove existing verified status if it exists
            const existingStatus = this.profileInfo.querySelector('.verified-status');
            if (existingStatus) {
                existingStatus.remove();
            }

            // Add verification status to profile header if verified
            if (userData.isVerified) {
                const verifiedStatus = document.createElement('div');
                verifiedStatus.className = 'verified-status';
                verifiedStatus.innerHTML = `
                    <i class="ri-verified-badge-fill"></i>
                    Verified Account
                `;
                this.profileInfo.appendChild(verifiedStatus);
            }

            // Add account status section if viewing own profile
            if (auth.currentUser?.uid === userId) {
                this.showAccountStatus(userData);
            }
        }
    }

    generateOembedJson(userData) {
        const oembedLink = document.createElement('link');
        oembedLink.rel = 'alternate';
        oembedLink.type = 'application/json+oembed';
        oembedLink.href = `https://buzz.nova.xxavvgroup.com/api/oembed?url=https://buzz.nova.xxavvgroup.com/profile/${this.urlUserId}`;
        document.head.appendChild(oembedLink);
    }

    showAccountStatus(userData) {
        const statusSection = document.createElement('div');
        statusSection.className = 'account-status glass';
        
        const warnings = userData.warnings || 0;
        const strikes = userData.strikes || 0;
        const isHidden = userData.isHidden || false;
        const isBanned = userData.isBanned || false;

        let statusHtml = `
            <h3><i class="ri-shield-user-line"></i> Account Status</h3>
            <div class="status-items">
                <div class="status-item ${strikes > 0 ? 'warning' : ''}">
                    <span class="status-label">Strikes:</span>
                    <span class="status-value">${strikes}/3</span>
                    ${strikes > 0 ? `
                        <div class="status-detail">
                            Last strike: ${userData.lastStrike ? 
                                `${userData.lastStrike.reason || 'No reason provided'} 
                                (${new Date(userData.lastStrike.date.toDate()).toLocaleDateString()})` : 
                                'N/A'}
                        </div>
                    ` : ''}
                </div>
                <div class="status-item ${warnings > 0 ? 'warning' : ''}">
                    <span class="status-label">Warnings:</span>
                    <span class="status-value">${warnings}</span>
                    ${warnings > 0 ? `
                        <div class="status-detail">
                            Last warning: ${userData.lastWarning ? 
                                `${userData.lastWarning.reason || 'No reason provided'}
                                (${new Date(userData.lastWarning.date.toDate()).toLocaleDateString()})` : 
                                'N/A'}
                        </div>
                    ` : ''}
                </div>`;

        if (isHidden) {
            statusHtml += `
                <div class="status-item error">
                    <span class="status-label">Account Hidden</span>
                    <div class="status-detail">
                        Reason: ${userData.hiddenReason || 'No reason provided'}
                        (${new Date(userData.hiddenAt.toDate()).toLocaleDateString()})
                    </div>
                </div>`;
        }

        if (isBanned) {
            statusHtml += `
                <div class="status-item error">
                    <span class="status-label">Account Banned</span>
                    <div class="status-detail">
                        Reason: ${userData.banReason || 'No reason provided'}
                        (${new Date(userData.bannedAt.toDate()).toLocaleDateString()})
                    </div>
                </div>`;
        }

        statusHtml += '</div>';
        statusSection.innerHTML = statusHtml;

        // Insert after profile header
        const profileHeader = document.querySelector('.profile-header');
        profileHeader.parentNode.insertBefore(statusSection, profileHeader.nextSibling);
    }

    async loadUserPosts(userId) {
        this.showLoadingState();
        try {
            const q = query(
                collection(db, 'posts'),
                where('userId', '==', userId),
                orderBy('createdAt', 'desc'),
                limit(this.postsPerPage)
            );

            onSnapshot(q, (snapshot) => {
                this.removeLoader();
                this.lastVisible = snapshot.docs[snapshot.docs.length - 1];
                
                if (this.postsCount) this.postsCount.textContent = snapshot.size;
                let totalLikes = 0;

                snapshot.forEach(doc => {
                    const post = doc.data();
                    totalLikes += post.likes || 0;
                    this.displayPost(post, doc.id);
                });

                if (this.likesCount) this.likesCount.textContent = totalLikes;
            });
        } catch (error) {
            console.error('Error loading posts:', error);
            this.removeLoader();
        }
    }

    displayPost(post, postId) {
        const postElement = document.createElement('div');
        postElement.className = 'post';
        const dateString = formatPostDate(post.createdAt);
        
        postElement.innerHTML = `
            <div class="post-header">
                <strong>${post.username}</strong>
                <span>${dateString}</span>
            </div>
            <div class="post-content">
                <p>${post.content}</p>
            </div>
            <div class="post-actions">
                <span><i class="ri-heart-3-line"></i> ${post.likes || 0}</span>
                <a href="post.html?id=${postId}" class="view-post-btn">
                    <i class="ri-chat-1-line"></i> View Discussion
                </a>
            </div>
        `;

        this.userPosts.appendChild(postElement);
    }

    async showEditProfileForm() {
        const user = auth.currentUser;
        if (!user) return;

        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const userData = userDoc.data();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        const form = document.createElement('form');
        form.className = 'edit-profile-form';
        form.innerHTML = `
            <div class="form-header">
                <i class="ri-edit-2-line"></i>
                <h3>Edit Profile</h3>
            </div>
            <div class="form-group">
                <label class="form-label" for="editUsername">Username <span class="required">*</span></label>
                <input type="text" id="editUsername" class="form-input" value="${userData.username}" required>
                <small class="input-help">This is your unique identifier</small>
            </div>
            <div class="form-group">
                <label class="form-label" for="editDisplayName">Display Name</label>
                <input type="text" id="editDisplayName" class="form-input" value="${userData.displayName || ''}" placeholder="${userData.username}">
                <small class="input-help">This is how your name appears to others</small>
            </div>
            <div class="button-group">
                <button type="submit" class="form-button">Save Changes</button>
                <button type="button" class="form-button secondary cancel-btn">Cancel</button>
            </div>
        `;

        overlay.appendChild(form);
        document.body.appendChild(overlay);

        const closeOverlay = () => overlay.remove();

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeOverlay();
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newUsername = document.getElementById('editUsername').value.trim();
            const newDisplayName = document.getElementById('editDisplayName').value.trim();
            
            if (newUsername) {
                await updateDoc(doc(db, 'users', user.uid), {
                    username: newUsername,
                    usernameLower: newUsername.toLowerCase(),
                    displayName: newDisplayName || newUsername // Use username as fallback
                });
                closeOverlay();
            }
        });

        form.querySelector('.cancel-btn').addEventListener('click', closeOverlay);
    }

    async handleProfilePictureUpload() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                if (file.size > 5 * 1024 * 1024) { // 5MB limit
                    alert('Image size must be less than 5MB');
                    return;
                }

                const reader = new FileReader();
                reader.onload = async (e) => {
                    const base64String = e.target.result;
                    try {
                        await updateDoc(doc(db, 'users', auth.currentUser.uid), {
                            profilePicUrl: base64String
                        });
                        this.updateProfilePicture(base64String);
                    } catch (error) {
                        console.error('Error updating profile picture:', error);
                        alert('Error updating profile picture');
                    }
                };
                reader.readAsDataURL(file);
            }
        };

        input.click();
    }

    updateProfilePicture(base64String) {
        if (this.profileAvatar) {
            this.profileAvatar.innerHTML = base64String ? 
                `<img src="${base64String}" alt="Profile Picture">` :
                '<i class="ri-user-fill"></i>';
        }
    }

    addScrollListener() {
        window.addEventListener('scroll', () => {
            if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 2 && !this.isLoading && !this.allPostsLoaded) {
                this.loadMorePosts();
            }
        });
    }

    async loadMorePosts() {
        if (this.isLoading || this.allPostsLoaded || !this.lastVisible) return;
        this.isLoading = true;
        this.showLoadingState();

        try {
            const q = query(
                collection(db, 'posts'),
                where('userId', '==', this.urlUserId || auth.currentUser.uid),
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

            // Update lastVisible only if we got results
            this.lastVisible = snapshot.docs[snapshot.docs.length - 1];
            
            // Clear existing posts to prevent duplicates
            const currentPosts = this.userPosts.querySelectorAll('.post');
            currentPosts.forEach(post => post.remove());

            snapshot.forEach(doc => {
                const post = doc.data();
                this.displayPost(post, doc.id);
            });

        } catch (error) {
            console.error('Error loading more posts:', error);
        } finally {
            this.isLoading = false;
            this.removeLoader();
        }
    }

    showLoadingState() {
        const loader = document.createElement('div');
        loader.className = 'loader';
        loader.innerHTML = '<i class="ri-loader-4-line"></i> Loading...';
        this.userPosts.appendChild(loader);
    }

    removeLoader() {
        const loader = this.userPosts.querySelector('.loader');
        if (loader) {
            loader.remove();
        }
    }
}

// Only initialize if we're on the profile page
if (window.location.pathname.includes('profile.html')) {
    new Profile();
}
