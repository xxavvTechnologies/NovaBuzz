import { auth, db } from './config.js';
import { doc, getDoc, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { formatPostDate, checkContent, textToHtml } from './utils.js';
import { EmbedGenerator } from './embeds.js';

class PostDetail {
    constructor() {
        this.postId = new URLSearchParams(window.location.search).get('id');
        if (!this.postId) {
            window.location.href = 'home.html';
            return;
        }

        this.setupUI();
        this.loadPost();
        this.setupComments();
    }

    setupUI() {
        this.postContent = document.getElementById('postContent');
        this.commentText = document.getElementById('commentText');
        this.submitComment = document.getElementById('submitComment');
        this.commentsContainer = document.getElementById('comments');

        this.submitComment.addEventListener('click', () => this.addComment());
    }

    async loadPost() {
        const postDoc = await getDoc(doc(db, 'posts', this.postId));
        if (!postDoc.exists()) {
            window.location.href = 'home.html';
            return;
        }

        const post = postDoc.data();
        
        // Update meta tags for SEO and social sharing
        const embedData = EmbedGenerator.generatePostEmbed(post, this.postId);
        EmbedGenerator.updateMetaTags(embedData);

        // Generate oEmbed JSON
        this.generateOembedJson(post);

        const dateString = formatPostDate(post.createdAt);

        this.postContent.innerHTML = `
            <div class="post-detail-header">
                <div class="post-meta">
                    <div class="author-info">
                        <strong>${post.username}</strong>
                    </div>
                    <span>${dateString}</span>
                </div>
                <div class="post-likes">
                    <i class="ri-heart-3-line"></i> ${post.likes || 0} likes
                </div>
            </div>
            <div class="post-detail-content">
                <p>${textToHtml(post.content)}</p>
                ${post.isVerified ? 
                    '<span class="verified-post-badge">Posted by verified user</span>' : 
                    ''}
            </div>
        `;
    }

    generateOembedJson(post) {
        const oembedLink = document.createElement('link');
        oembedLink.rel = 'alternate';
        oembedLink.type = 'application/json+oembed';
        oembedLink.href = `https://buzz.nova.xxavvgroup.com/api/oembed?url=https://buzz.nova.xxavvgroup.com/post/${this.postId}`;
        document.head.appendChild(oembedLink);
    }

    setupComments() {
        const q = query(
            collection(db, 'posts', this.postId, 'comments'),
            orderBy('createdAt', 'desc')
        );

        onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    this.displayComment(change.doc.data());
                }
            });
        });
    }

    async addComment() {
        const content = this.commentText.value.trim();
        if (!content) return;

        try {
            // Check content before posting comment
            await checkContent(content, 'comment');

            const user = auth.currentUser;
            if (!user) {
                alert('Please login to comment');
                return;
            }

            const userDoc = await getDoc(doc(db, 'users', user.uid));
            const userData = userDoc.data();

            await addDoc(collection(db, 'posts', this.postId, 'comments'), {
                content,
                userId: user.uid,
                username: userData.username,
                createdAt: serverTimestamp()
            });

            this.commentText.value = '';
        } catch (error) {
            alert(error.message);
            return;
        }
    }

    displayComment(comment) {
        const commentElement = document.createElement('div');
        commentElement.className = 'comment glass';
        const dateString = formatPostDate(comment.createdAt);

        commentElement.innerHTML = `
            <div class="comment-header">
                <strong>${comment.username}</strong>
                <span>${dateString}</span>
            </div>
            <div class="comment-content">
                <p>${comment.content}</p>
            </div>
        `;

        this.commentsContainer.insertBefore(commentElement, this.commentsContainer.firstChild);
    }
}

new PostDetail();
