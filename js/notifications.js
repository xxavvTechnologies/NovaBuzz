import { auth, db } from './config.js';
import { 
    collection, 
    addDoc, 
    query, 
    where, 
    orderBy, 
    onSnapshot,
    serverTimestamp,
    limit,
    getDocs,
    updateDoc,
    doc
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

export class NotificationSystem {
    constructor() {
        this.notifications = [];
        this.unreadCount = 0;
        this.setupNotificationUI();
        this.setupRealtimeNotifications();
        this.mentionRegex = /@(\w+)/g;
    }

    setupNotificationUI() {
        // Create notification bell in nav
        const navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        const notifBtn = document.createElement('button');
        notifBtn.className = 'nav-link notification-btn';
        notifBtn.innerHTML = `
            <i class="ri-notification-3-line"></i>
            <span class="notification-badge" style="display: none;">0</span>
        `;

        navLinks.insertBefore(notifBtn, navLinks.firstChild);

        notifBtn.addEventListener('click', () => this.showNotificationPanel());
    }

    async setupRealtimeNotifications() {
        auth.onAuthStateChanged(user => {
            if (user) {
                const notifQuery = query(
                    collection(db, 'notifications'),
                    where('recipientId', '==', user.uid),
                    orderBy('createdAt', 'desc'),
                    limit(50)
                );

                onSnapshot(notifQuery, snapshot => {
                    snapshot.docChanges().forEach(change => {
                        if (change.type === 'added') {
                            const notification = change.doc.data();
                            if (!notification.read) {
                                this.showNotification(notification);
                                this.updateUnreadCount();
                            }
                        }
                    });
                });
            }
        });
    }

    async createNotification(data) {
        if (!auth.currentUser) return;

        const notification = {
            ...data,
            createdAt: serverTimestamp(),
            read: false
        };

        try {
            await addDoc(collection(db, 'notifications'), notification);
        } catch (error) {
            console.error('Error creating notification:', error);
        }
    }

    showNotification(notification) {
        const toast = document.createElement('div');
        toast.className = 'notification-toast';
        toast.innerHTML = `
            <i class="${this.getNotificationIcon(notification.type)}"></i>
            <div class="notification-content">
                <p>${notification.message}</p>
                <small>${this.getTimeAgo(notification.createdAt)}</small>
            </div>
            <button class="close-notification">
                <i class="ri-close-line"></i>
            </button>
        `;

        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('show');
            setTimeout(() => toast.remove(), 5000);
        }, 100);

        toast.querySelector('.close-notification').addEventListener('click', () => toast.remove());
    }

    showNotificationPanel() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="notifications-panel glass">
                <div class="modal-header">
                    <h3>Notifications</h3>
                    <button class="close-btn">
                        <i class="ri-close-line"></i>
                    </button>
                </div>
                <div class="notifications-list">
                    ${this.notifications.map(notif => this.renderNotification(notif)).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.markAllAsRead();

        overlay.querySelector('.close-btn').addEventListener('click', () => overlay.remove());
    }

    updateUnreadCount() {
        const badge = document.querySelector('.notification-badge');
        if (!badge) return;

        this.unreadCount = this.notifications.filter(n => !n.read).length;
        badge.textContent = this.unreadCount;
        badge.style.display = this.unreadCount > 0 ? 'block' : 'none';
    }

    async markAllAsRead() {
        if (!auth.currentUser) return;

        const unreadQuery = query(
            collection(db, 'notifications'),
            where('recipientId', '==', auth.currentUser.uid),
            where('read', '==', false)
        );

        const snapshot = await getDocs(unreadQuery);
        const updates = snapshot.docs.map(doc => 
            updateDoc(doc.ref, { read: true })
        );

        await Promise.all(updates);
        this.updateUnreadCount();
    }

    getNotificationIcon(type) {
        switch (type) {
            case 'like': return 'ri-heart-3-line';
            case 'comment': return 'ri-chat-1-line';
            case 'mention': return 'ri-at-line';
            case 'quote': return 'ri-double-quotes-l';
            default: return 'ri-notification-3-line';
        }
    }

    getTimeAgo(timestamp) {
        if (!timestamp) return 'just now';
        const seconds = Math.floor((new Date() - timestamp.toDate()) / 1000);
        
        const intervals = {
            year: 31536000,
            month: 2592000,
            week: 604800,
            day: 86400,
            hour: 3600,
            minute: 60,
            second: 1
        };

        for (let [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInUnit);
            if (interval > 1) {
                return `${interval} ${unit}s ago`;
            }
            if (interval === 1) {
                return `1 ${unit} ago`;
            }
        }
        
        return 'just now';
    }

    renderNotification(notif) {
        return `
            <div class="notification-item ${notif.read ? '' : 'unread'}">
                <i class="${this.getNotificationIcon(notif.type)}"></i>
                <div class="notification-content">
                    <p>${notif.message}</p>
                    <small>${this.getTimeAgo(notif.createdAt)}</small>
                </div>
            </div>
        `;
    }
}
