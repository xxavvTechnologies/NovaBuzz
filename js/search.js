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
        // Only initialize if we're on the search page
        if (!window.location.pathname.includes('search.html')) return;
        
        this.searchInput = document.querySelector('.search-input');
        this.searchResults = document.querySelector('.search-results');
        this.hashtagList = document.querySelector('.hashtag-list');
        
        this.setupSearchListeners();
        this.loadTrendingHashtags();
        
        // Focus search input on page load
        this.searchInput?.focus();

        this.searchHistory = JSON.parse(localStorage.getItem('searchHistory') || '[]');
        this.setupClearHistoryButton();
        this.displaySearchHistory();
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

    setupClearHistoryButton() {
        const clearBtn = document.querySelector('.clear-history-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clearSearchHistory();
            });
        }
    }

    async performSearch(query) {
        this.searchResults.innerHTML = '<div class="loader">Searching...</div>';
        
        try {
            let userResults = [];
            let postResults = [];
            let hashtagResults = [];
            
            if (query.startsWith('#')) {
                // Search for posts with specific hashtag
                const hashtag = query.substring(1).toLowerCase();
                postResults = await this.searchPostsByHashtag(hashtag);
            } else if (query.startsWith('@')) {
                // Search for users
                userResults = await this.searchUsers(query.substring(1));
            } else {
                // Combined search
                [userResults, postResults] = await Promise.all([
                    this.searchUsers(query),
                    this.searchPosts(query)
                ]);
            }

            this.displaySearchResults([...userResults, ...postResults]);
        } catch (error) {
            console.error('Search error:', error);
            this.searchResults.innerHTML = 'Error performing search';
        }

        // Add to search history
        this.addToSearchHistory(query);
    }

    addToSearchHistory(query) {
        if (!query) return;
        
        this.searchHistory = this.searchHistory.filter(item => item.query !== query);
        this.searchHistory.unshift({
            query,
            timestamp: Date.now()
        });

        // Keep only last 10 searches
        this.searchHistory = this.searchHistory.slice(0, 10);
        localStorage.setItem('searchHistory', JSON.stringify(this.searchHistory));
        this.displaySearchHistory();
    }

    displaySearchHistory() {
        const recentList = document.querySelector('.recent-list');
        if (!recentList) return;

        recentList.innerHTML = this.searchHistory.length ? 
            this.searchHistory.map(item => `
                <div class="recent-search-item" data-query="${item.query}">
                    <i class="ri-time-line"></i>
                    <span>${item.query}</span>
                    <i class="ri-close-line remove-search"></i>
                </div>
            `).join('') : 
            '<div class="no-history">No recent searches</div>';

        // Add click handlers
        recentList.querySelectorAll('.recent-search-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('remove-search')) {
                    this.removeFromHistory(item.dataset.query);
                } else {
                    this.searchInput.value = item.dataset.query;
                    this.performSearch(item.dataset.query);
                }
            });
        });
    }

    clearSearchHistory() {
        this.searchHistory = [];
        localStorage.setItem('searchHistory', '[]');
        this.displaySearchHistory();
    }

    removeFromHistory(query) {
        this.searchHistory = this.searchHistory.filter(item => item.query !== query);
        localStorage.setItem('searchHistory', JSON.stringify(this.searchHistory));
        this.displaySearchHistory();
    }

    async searchUsers(query) {
        const usersRef = collection(db, 'users');
        const queryLower = query.toLowerCase();
        const q = fbQuery(usersRef,
            where('usernameLower', '>=', queryLower),
            where('usernameLower', '<=', queryLower + '\uf8ff'),
            limit(10)
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
        const queryLower = query.toLowerCase();
        
        // Search in content
        const contentQuery = fbQuery(postsRef,
            where('contentLower', '>=', queryLower),
            where('contentLower', '<=', queryLower + '\uf8ff'),
            limit(10)
        );

        const snapshot = await getDocs(contentQuery);
        return snapshot.docs.map(doc => ({
            type: 'post',
            id: doc.id,
            data: doc.data()
        }));
    }

    async searchPostsByHashtag(hashtag) {
        const postsRef = collection(db, 'posts');
        const q = fbQuery(postsRef,
            where('hashtags', 'array-contains', hashtag.toLowerCase()),
            orderBy('createdAt', 'desc'),
            limit(20)
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

    observeSearchInput() {
        const options = {
            root: null,
            rootMargin: '0px',
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.searchInput?.focus();
                }
            });
        }, options);

        if (this.searchInput) {
            observer.observe(this.searchInput);
        }
    }
}

// Initialize only if we're on the search page
if (window.location.pathname.includes('search.html')) {
    new SearchWidget();
}
