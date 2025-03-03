import { db } from './config.js';
import { 
    collection, 
    query as fbQuery, // Rename query to fbQuery to avoid conflict
    where, 
    orderBy, 
    limit, 
    getDocs, 
    startAt, 
    endAt 
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

export class SearchWidget {
    constructor() {
        this.setupSearchSidebar();
        this.setupSearchListeners();
        this.loadTrendingHashtags();
        this.debounceTimer = null;
    }

    setupSearchSidebar() {
        const sidebar = document.createElement('div');
        sidebar.className = 'search-sidebar';
        sidebar.innerHTML = `
            <div class="search-box glass">
                <div class="search-input-wrapper">
                    <i class="ri-search-line"></i>
                    <input type="text" class="search-input" placeholder="Search users and posts...">
                </div>
                <div class="search-results"></div>
            </div>
            <div class="trending-hashtags">
                <h3><i class="ri-hashtag"></i> Trending Topics</h3>
                <div class="hashtag-list">
                    <div class="loader">Loading trending topics...</div>
                </div>
            </div>
        `;

        const mainContent = document.querySelector('.main-content');
        mainContent.appendChild(sidebar);

        this.searchInput = sidebar.querySelector('.search-input');
        this.searchResults = sidebar.querySelector('.search-results');
        this.hashtagList = sidebar.querySelector('.hashtag-list');
    }

    setupSearchListeners() {
        this.searchInput.addEventListener('input', () => {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                const query = this.searchInput.value.trim();
                if (query.length >= 2) {
                    this.performSearch(query);
                } else {
                    this.searchResults.innerHTML = '';
                }
            }, 300);
        });
    }

    async performSearch(query) {
        this.searchResults.innerHTML = '<div class="loader">Searching...</div>';
        
        try {
            // Search users
            const usersQuery = query.startsWith('@') ? query.substring(1) : query;
            const userResults = await this.searchUsers(usersQuery);

            // Search posts
            const postResults = await this.searchPosts(query);

            // Combine and display results
            this.displaySearchResults([...userResults, ...postResults]);
        } catch (error) {
            console.error('Search error:', error);
            this.searchResults.innerHTML = 'Error performing search';
        }
    }

    async searchUsers(query) {
        const usersRef = collection(db, 'users');
        const q = fbQuery(usersRef,  // Use fbQuery instead of query
            where('usernameLower', '>=', query.toLowerCase()),
            where('usernameLower', '<=', query.toLowerCase() + '\uf8ff'),
            limit(5)
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            type: 'user',
            id: doc.id,
            data: doc.data()
        }));
    }

    async searchPosts(query) {
        const postsRef = collection(db, 'posts');
        const q = fbQuery(postsRef,  // Use fbQuery instead of query
            where('content', '>=', query),
            where('content', '<=', query + '\uf8ff'),
            limit(5)
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            type: 'post',
            id: doc.id,
            data: doc.data()
        }));
    }

    displaySearchResults(results) {
        if (results.length === 0) {
            this.searchResults.innerHTML = 'No results found';
            return;
        }

        this.searchResults.innerHTML = results.map(result => {
            if (result.type === 'user') {
                return `
                    <a href="profile.html?uid=${result.id}" class="search-result-item">
                        <div class="author-avatar">
                            ${result.data.profilePicUrl ? 
                                `<img src="${result.data.profilePicUrl}" alt="${result.data.username}">` :
                                `<i class="ri-user-fill"></i>`}
                        </div>
                        <div>
                            <strong>${result.data.username}</strong>
                            ${result.data.isVerified ? 
                                `<span class="verified-badge"><i class="ri-verified-badge-fill"></i></span>` : 
                                ''}
                        </div>
                    </a>
                `;
            } else {
                return `
                    <a href="post.html?id=${result.id}" class="search-result-item">
                        <i class="ri-chat-1-line"></i>
                        <div>${result.data.content.substring(0, 100)}...</div>
                    </a>
                `;
            }
        }).join('');
    }

    async loadTrendingHashtags() {
        try {
            const hashtagsRef = collection(db, 'hashtags');
            const q = fbQuery(hashtagsRef,  // Use fbQuery instead of query
                orderBy('count', 'desc'), 
                limit(5)
            );

            const snapshot = await getDocs(q);
            
            if (snapshot.empty) {
                this.hashtagList.innerHTML = 'No trending topics yet';
                return;
            }

            this.hashtagList.innerHTML = snapshot.docs.map(doc => `
                <div class="hashtag-item" data-hashtag="${doc.id}">
                    <span class="hashtag-name">#${doc.id}</span>
                    <span class="hashtag-count">${doc.data().count} posts</span>
                </div>
            `).join('');

            // Add click handlers for hashtags
            this.hashtagList.querySelectorAll('.hashtag-item').forEach(item => {
                item.addEventListener('click', () => {
                    this.searchInput.value = `#${item.dataset.hashtag}`;
                    this.performSearch(this.searchInput.value);
                });
            });
        } catch (error) {
            console.error('Error loading trending hashtags:', error);
            this.hashtagList.innerHTML = 'Error loading trending topics';
        }
    }
}
