import { auth, db } from './config.js';
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

class Settings {
    constructor() {
        this.setupAuthListener();
        this.setupEventListeners();
    }

    setupAuthListener() {
        auth.onAuthStateChanged(async user => {
            if (!user) {
                window.location.href = 'index.html';
                return;
            }

            await this.loadUserSettings(user.uid);
        });
    }

    setupEventListeners() {
        document.getElementById('saveAccountSettings').addEventListener('click', () => this.saveSettings());
        document.getElementById('deactivateAccount').addEventListener('click', () => this.deactivateAccount());
        document.getElementById('deleteAccount').addEventListener('click', () => this.deleteAccount());
    }

    async loadUserSettings(userId) {
        try {
            const userDoc = await getDoc(doc(db, 'users', userId));
            const settings = userDoc.data().settings || {};
            
            // Load settings into form
            document.getElementById('emailNotifs').checked = settings.emailNotifications ?? true;
            document.getElementById('publicProfile').checked = settings.publicProfile ?? true;
            document.getElementById('showOnline').checked = settings.showOnline ?? true;
            document.getElementById('username').value = userDoc.data().username || '';
            document.getElementById('displayName').value = userDoc.data().displayName || '';

        } catch (error) {
            console.error('Error loading settings:', error);
            alert('Error loading settings');
        }
    }

    async saveSettings() {
        if (!auth.currentUser) return;

        try {
            const settings = {
                emailNotifications: document.getElementById('emailNotifs').checked,
                publicProfile: document.getElementById('publicProfile').checked,
                showOnline: document.getElementById('showOnline').checked,
                lastUpdated: serverTimestamp()
            };

            const username = document.getElementById('username').value.trim();
            const displayName = document.getElementById('displayName').value.trim();

            if (!username) {
                alert('Username is required');
                return;
            }

            await updateDoc(doc(db, 'users', auth.currentUser.uid), {
                settings,
                username,
                usernameLower: username.toLowerCase(),
                displayName: displayName || username, // Use username as fallback
                lastUpdated: serverTimestamp()
            });

            alert('Settings saved successfully');
        } catch (error) {
            console.error('Error saving settings:', error);
            alert('Error saving settings');
        }
    }

    async deactivateAccount() {
        if (!confirm('Are you sure you want to deactivate your account? You can reactivate it later.')) return;

        try {
            await updateDoc(doc(db, 'users', auth.currentUser.uid), {
                isDeactivated: true,
                deactivatedAt: serverTimestamp()
            });

            await auth.signOut();
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Error deactivating account:', error);
            alert('Error deactivating account');
        }
    }

    async deleteAccount() {
        if (!confirm('Are you sure you want to permanently delete your account? This cannot be undone.')) return;
        if (!confirm('Last chance! All your data will be permanently deleted.')) return;

        try {
            // Store deletion record
            await addDoc(collection(db, 'deletedUsers'), {
                userId: auth.currentUser.uid,
                deletedAt: serverTimestamp(),
                userDeleted: true
            });

            // Delete user data
            await deleteDoc(doc(db, 'users', auth.currentUser.uid));
            
            // Delete Firebase Auth account
            await auth.currentUser.delete();
            
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Error deleting account:', error);
            alert('Error deleting account');
        }
    }
}

// Initialize settings
new Settings();
