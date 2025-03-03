import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

const firebaseConfig = {
    apiKey: "AIzaSyAeNLHp2EO50B0PrZuBchOJvxhxHlVuVu4",
    authDomain: "novasuite-e4257.firebaseapp.com",
    projectId: "novasuite-e4257",
    storageBucket: "novasuite-e4257.firebasestorage.app",
    messagingSenderId: "349176160657",
    appId: "1:349176160657:web:69b8181f7fa2122cf63a30",
    measurementId: "G-S0DGZ8M615"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
