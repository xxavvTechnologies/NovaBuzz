import { auth, db } from './config.js';
import { 
    doc, 
    updateDoc, 
    deleteDoc, 
    collection, 
    query, 
    where, 
    getDocs, 
    getDoc, 
    addDoc,
    serverTimestamp,
    increment 
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

export class AdminPanel {
    constructor() {
        this.setupAdminCheck();
    }

    async setupAdminCheck() {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                const isAdmin = userDoc.data()?.isAdmin;
                if (isAdmin) {
                    // Wait for DOM to be ready
                    this.waitForElement('.profile-container').then(() => {
                        this.showAdminControls();
                    });
                }
            }
        });
    }

    // Helper method to wait for element
    waitForElement(selector) {
        return new Promise(resolve => {
            if (document.querySelector(selector)) {
                return resolve(document.querySelector(selector));
            }

            const observer = new MutationObserver(() => {
                if (document.querySelector(selector)) {
                    observer.disconnect();
                    resolve(document.querySelector(selector));
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    }

    showAdminControls() {
        // Add admin controls to profile pages
        if (window.location.pathname.includes('profile.html')) {
            const profileContainer = document.querySelector('.profile-container');
            if (!profileContainer) return; // Guard clause

            const adminSection = document.createElement('div');
            adminSection.className = 'admin-controls glass';
            adminSection.innerHTML = `
                <h3><i class="ri-shield-keyhole-line"></i> Admin Controls</h3>
                <div class="admin-actions">
                    <button class="admin-btn warn-user">
                        <i class="ri-alarm-warning-line"></i> Warn User
                    </button>
                    <button class="admin-btn hide-account">
                        <i class="ri-eye-off-line"></i> Hide Account
                    </button>
                    <button class="admin-btn strike-account">
                        <i class="ri-flag-line"></i> Strike Account
                    </button>
                    <button class="admin-btn ban-account">
                        <i class="ri-prohibit-line"></i> Ban Account
                    </button>
                    <button class="admin-btn delete-account danger">
                        <i class="ri-delete-bin-line"></i> Delete Account
                    </button>
                </div>
            `;

            profileContainer.insertBefore(adminSection, profileContainer.firstChild);
            this.setupAdminActions();
        }

        // Add admin controls to posts
        document.querySelectorAll('.post').forEach(post => {
            const actions = post.querySelector('.post-actions');
            if (!actions) return;

            const adminBtn = document.createElement('button');
            adminBtn.className = 'admin-post-btn';
            adminBtn.innerHTML = '<i class="ri-shield-keyhole-line"></i> Admin';
            actions.appendChild(adminBtn);

            adminBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showPostAdminMenu(post);
            });
        });
    }

    async setupAdminActions() {
        const urlParams = new URLSearchParams(window.location.search);
        const targetUserId = urlParams.get('uid');
        if (!targetUserId) return;

        const actions = {
            'warn-user': this.warnUser,
            'hide-account': this.hideAccount,
            'strike-account': this.strikeAccount,
            'ban-account': this.banAccount,
            'delete-account': this.deleteAccount
        };

        document.querySelectorAll('.admin-btn').forEach(btn => {
            const action = [...btn.classList].find(c => actions[c]);
            if (action) {
                btn.addEventListener('click', () => {
                    this.showAdminActionModal(targetUserId, actions[action].bind(this));
                });
            }
        });
    }

    showAdminActionModal(userId, actionFn) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="admin-modal glass">
                <h3>Admin Action</h3>
                <textarea placeholder="Reason (optional)" class="admin-reason"></textarea>
                <div class="admin-modal-actions">
                    <button class="form-button confirm">Confirm</button>
                    <button class="form-button secondary cancel">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const reason = overlay.querySelector('.admin-reason');
        overlay.querySelector('.confirm').addEventListener('click', () => {
            actionFn(userId, reason.value.trim());
            overlay.remove();
        });

        overlay.querySelector('.cancel').addEventListener('click', () => {
            overlay.remove();
        });
    }

    async warnUser(userId, reason) {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
            warnings: increment(1),
            lastWarning: { reason, date: serverTimestamp() }
        });
        alert('User has been warned');
    }

    async hideAccount(userId, reason) {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
            isHidden: true,
            hiddenReason: reason,
            hiddenAt: serverTimestamp()
        });
        alert('Account has been hidden');
    }

    async strikeAccount(userId, reason) {
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);
        const userData = userDoc.data();
        const currentStrikes = (userData.strikes || 0) + 1;

        const update = {
            strikes: currentStrikes,
            lastStrike: { reason, date: serverTimestamp() }
        };

        if (currentStrikes >= 3) {
            update.isBanned = true;
            update.banReason = 'Automatic ban: Received 3 strikes';
            update.bannedAt = serverTimestamp();
            update.autoban = true;
        }

        await updateDoc(userRef, update);

        if (currentStrikes >= 3) {
            alert('User has received 3 strikes and has been automatically banned');
        } else {
            alert(`User has been struck (${currentStrikes}/3 strikes)`);
        }
    }

    async banAccount(userId, reason) {
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
            isBanned: true,
            banReason: reason,
            bannedAt: serverTimestamp()
        });
        alert('Account has been banned');
    }

    async deleteAccount(userId, reason) {
        if (!confirm('Are you sure you want to delete this account? This cannot be undone.')) {
            return;
        }

        // Store deletion record
        await addDoc(collection(db, 'deletedUsers'), {
            userId,
            deletedBy: auth.currentUser.uid,
            reason,
            deletedAt: serverTimestamp()
        });

        // Delete user data
        await deleteDoc(doc(db, 'users', userId));
        
        // Delete user's posts
        const postsQuery = query(collection(db, 'posts'), where('userId', '==', userId));
        const posts = await getDocs(postsQuery);
        posts.forEach(async (post) => {
            await deleteDoc(doc(db, 'posts', post.id));
        });

        alert('Account has been deleted');
        window.location.href = 'home.html';
    }

    showPostAdminMenu(postElement) {
        const postId = postElement.dataset.postId;
        const menu = document.createElement('div');
        menu.className = 'admin-post-menu glass';
        menu.innerHTML = `
            <button class="admin-menu-item delete-post">
                <i class="ri-delete-bin-line"></i> Delete Post
            </button>
            <button class="admin-menu-item hide-post">
                <i class="ri-eye-off-line"></i> Hide Post
            </button>
        `;

        postElement.appendChild(menu);

        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };

        setTimeout(() => document.addEventListener('click', closeMenu), 0);

        menu.querySelector('.delete-post').addEventListener('click', () => {
            this.deletePost(postId);
            menu.remove();
        });

        menu.querySelector('.hide-post').addEventListener('click', () => {
            this.hidePost(postId);
            menu.remove();
        });
    }

    async deletePost(postId) {
        if (confirm('Delete this post?')) {
            await deleteDoc(doc(db, 'posts', postId));
        }
    }

    async hidePost(postId) {
        await updateDoc(doc(db, 'posts', postId), {
            isHidden: true,
            hiddenAt: serverTimestamp(),
            hiddenBy: auth.currentUser.uid
        });
    }
}
