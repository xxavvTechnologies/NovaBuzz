import { auth, db } from './config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { doc, setDoc, serverTimestamp, getDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { checkContent } from './utils.js';

export class Auth {
    constructor() {
        this.initializeElements();
        this.setupAuthListeners();
        this.setupAuthStateObserver();
    }

    initializeElements() {
        this.loginBtn = document.getElementById('loginBtn');
        this.signupBtn = document.getElementById('signupBtn');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.authContainer = document.getElementById('authContainer');
        this.feedContainer = document.getElementById('feedContainer');
        
        // Set default values for optional elements
        this.hasAuthContainer = !!this.authContainer;
        this.hasFeedContainer = !!this.feedContainer;
    }

    setupAuthListeners() {
        if (this.loginBtn) {
            this.loginBtn.addEventListener('click', () => this.showLoginForm());
        }
        if (this.signupBtn) {
            this.signupBtn.addEventListener('click', () => this.showSignupForm());
        }
        if (this.logoutBtn) {
            this.logoutBtn.addEventListener('click', () => this.logout());
        }
    }

    setupAuthStateObserver() {
        auth.onAuthStateChanged(user => {
            if (user) {
                this.onLogin();
            } else {
                this.onLogout();
            }
        });
    }

    showLoginForm() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <form id="loginForm" class="form-container">
                <h2 class="form-title">Welcome Back</h2>
                <div class="form-group">
                    <label class="form-label" for="loginEmail">Email</label>
                    <input type="email" id="loginEmail" class="form-input" required>
                </div>
                <div class="form-group">
                    <label class="form-label" for="loginPassword">Password</label>
                    <input type="password" id="loginPassword" class="form-input" required>
                </div>
                <button type="submit" class="form-button">Login</button>
                <div class="form-switch">
                    Don't have an account? <a href="#" id="switchToSignup">Sign up</a>
                </div>
            </form>
        `;

        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });

        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            this.login(email, password);
        });
    }

    showSignupForm() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <form id="signupForm" class="form-container">
                <h2 class="form-title">Create Account</h2>
                <div class="form-group">
                    <label class="form-label" for="signupUsername">Username</label>
                    <input type="text" id="signupUsername" class="form-input" required>
                </div>
                <div class="form-group">
                    <label class="form-label" for="signupEmail">Email</label>
                    <input type="email" id="signupEmail" class="form-input" required>
                </div>
                <div class="form-group">
                    <label class="form-label" for="signupPassword">Password</label>
                    <input type="password" id="signupPassword" class="form-input" required>
                </div>
                <button type="submit" class="form-button">Sign Up</button>
                <div class="form-switch">
                    Already have an account? <a href="#" id="switchToLogin">Login</a>
                </div>
            </form>
        `;

        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });

        document.getElementById('signupForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('signupUsername').value;
            const email = document.getElementById('signupEmail').value;
            const password = document.getElementById('signupPassword').value;
            this.signup(email, password, username);
        });
    }

    async validateUsername(username) {
        if (username.length < 3) {
            throw new Error('Username must be at least 3 characters long');
        }
        if (username.length > 20) {
            throw new Error('Username cannot exceed 20 characters');
        }

        // Check for inappropriate content
        await checkContent(username, 'username');
        
        // Check if username already exists
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('usernameLower', '==', username.toLowerCase()));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            throw new Error('Username is already taken');
        }
    }

    async signup(email, password, username) {
        try {
            // Validate username before creating account
            await this.validateUsername(username.trim());

            const credential = await createUserWithEmailAndPassword(auth, email, password);
            await this.createUserProfile(credential.user.uid, username.trim(), email);
        } catch (error) {
            alert(error.message);
            throw error; // Re-throw to handle in UI
        }
    }

    async createUserProfile(userId, username, email) {
        const userRef = doc(db, 'users', userId);
        await setDoc(userRef, {
            username,
            usernameLower: username.toLowerCase(),
            displayName: username, // Initially set display name same as username
            email,
            createdAt: serverTimestamp(),
            settings: {
                emailNotifications: true,
                publicProfile: true,
                showOnline: true
            }
        });
    }

    async logout() {
        try {
            await signOut(auth);
        } catch (error) {
            alert(error.message);
        }
    }

    async login(email, password) {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
            
            // Check if user is banned
            if (userDoc.exists() && userDoc.data().isBanned) {
                await signOut(auth);
                throw new Error('This account has been banned. Please contact support.');
            }

            // Remove any existing auth modals
            document.querySelectorAll('.modal-overlay').forEach(modal => modal.remove());
            
        } catch (error) {
            console.error('Login error:', error);
            let errorMessage = 'Failed to login. Please try again.';
            
            switch (error.code) {
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                    errorMessage = 'Invalid email or password';
                    break;
                case 'auth/too-many-requests':
                    errorMessage = 'Too many failed attempts. Please try again later.';
                    break;
                case 'auth/user-disabled':
                    errorMessage = 'This account has been disabled.';
                    break;
            }
            
            alert(errorMessage);
            throw error;
        }
    }

    showUsernamePrompt() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <form id="usernameForm" class="form-container">
                <h3>Please create a username to continue</h3>
                <div class="form-group">
                    <input type="text" id="usernameInput" 
                        class="form-input" 
                        placeholder="Username (3-20 characters)"
                        minlength="3"
                        maxlength="20"
                        required>
                    <div class="form-feedback"></div>
                </div>
                <button type="submit" class="form-button">Save Username</button>
            </form>
        `;

        document.body.appendChild(overlay);

        const usernameInput = document.getElementById('usernameInput');
        const feedback = overlay.querySelector('.form-feedback');
        const submitBtn = overlay.querySelector('button');

        usernameInput.addEventListener('input', () => {
            const username = usernameInput.value.trim();
            if (username.length < 3) {
                feedback.textContent = 'Username must be at least 3 characters';
                feedback.className = 'form-feedback error';
                submitBtn.disabled = true;
            } else if (username.length > 20) {
                feedback.textContent = 'Username cannot exceed 20 characters';
                feedback.className = 'form-feedback error';
                submitBtn.disabled = true;
            } else {
                feedback.textContent = '';
                submitBtn.disabled = false;
            }
        });

        document.getElementById('usernameForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = usernameInput.value.trim();
            
            try {
                await this.validateUsername(username);
                await setDoc(doc(db, 'users', auth.currentUser.uid), {
                    username,
                    usernameLower: username.toLowerCase(),
                    email: auth.currentUser.email,
                    createdAt: serverTimestamp()
                });
                overlay.remove();
                this.onLogin();
            } catch (error) {
                feedback.textContent = error.message;
                feedback.className = 'form-feedback error';
            }
        });
    }

    async onLogin() {
        try {
            const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
            if (!userDoc.exists() || !userDoc.data().username) {
                if (this.hasAuthContainer) {
                    this.showUsernamePrompt();
                }
                return;
            }

            // Only modify UI elements that exist
            if (this.loginBtn) this.loginBtn.style.display = 'none';
            if (this.signupBtn) this.signupBtn.style.display = 'none';
            if (this.logoutBtn) this.logoutBtn.style.display = 'block';
            if (this.authContainer) this.authContainer.style.display = 'none';
            if (this.feedContainer) this.feedContainer.style.display = 'block';
        } catch (error) {
            console.error('Error checking user profile:', error);
        }
    }

    onLogout() {
        // Only modify UI elements that exist
        if (this.loginBtn) this.loginBtn.style.display = 'block';
        if (this.signupBtn) this.signupBtn.style.display = 'block';
        if (this.logoutBtn) this.logoutBtn.style.display = 'none';
        if (this.authContainer) this.authContainer.style.display = 'block';
        if (this.feedContainer) this.feedContainer.style.display = 'none';

        // Redirect to home if on profile page
        if (window.location.pathname.includes('profile.html')) {
            window.location.href = 'index.html';
        }
    }
}
