import { doc, getDoc, updateDoc, setDoc, serverTimestamp, increment as fbIncrement } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

export function formatPostDate(timestamp) {
    if (!timestamp || !timestamp.toDate) return 'Just now';
    
    const date = timestamp.toDate();
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export async function containsProfanity(text) {
    try {
        const response = await fetch(`https://www.purgomalum.com/service/containsprofanity?text=${encodeURIComponent(text)}`);
        const result = await response.text();
        return result === 'true';
    } catch (error) {
        console.error('Error checking profanity:', error);
        return false; // Fail open in case of API error
    }
}

export async function checkContent(text, type = 'post') {
    // Add custom banned words
    const customBannedWords = ['spam', 'scam', 'hack'];
    const lowerText = text.toLowerCase();
    
    // Check custom banned words
    if (customBannedWords.some(word => lowerText.includes(word))) {
        throw new Error(`This ${type} contains prohibited words`);
    }

    // Check profanity using API
    if (await containsProfanity(text)) {
        throw new Error(`This ${type} contains inappropriate language`);
    }

    return true;
}

export function extractHashtags(content) {
    const hashtagRegex = /#[\w]+/g;
    return [...new Set(content.match(hashtagRegex) || [])].map(tag => tag.slice(1).toLowerCase());
}

export async function updateHashtagCount(db, hashtag, shouldIncrement = true) {
    const hashtagRef = doc(db, 'hashtags', hashtag);
    const hashtagDoc = await getDoc(hashtagRef);

    if (hashtagDoc.exists()) {
        await updateDoc(hashtagRef, {
            count: fbIncrement(shouldIncrement ? 1 : -1),
            lastUsed: serverTimestamp()
        });
    } else if (shouldIncrement) {
        await setDoc(hashtagRef, {
            count: 1,
            lastUsed: serverTimestamp(),
            firstUsed: serverTimestamp()
        });
    }
}

export async function getCurrentUserData(db, userId) {
    if (!userId) return null;
    const userDoc = await getDoc(doc(db, 'users', userId));
    return userDoc.exists() ? userDoc.data() : null;
}

export function textToHtml(text, isVerified = false) {
    if (!text) return '';
    
    // Basic HTML escaping
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    // Only apply rich formatting for verified users
    if (isVerified) {
        // Bold: **text**
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Italic: *text*
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        
        // Underline: __text__
        html = html.replace(/__(.*?)__/g, '<u>$1</u>');
        
        // Strikethrough: ~~text~~
        html = html.replace(/~~(.*?)~~/g, '<s>$1</s>');
        
        // Code: `text`
        html = html.replace(/`(.*?)`/g, '<code>$1</code>');
    }

    // Always convert newlines
    html = html.replace(/\n/g, '<br>');
    
    return html;
}
