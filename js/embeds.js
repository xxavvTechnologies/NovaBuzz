export class EmbedGenerator {
    static generatePostEmbed(post, postId) {
        return {
            title: `${post.displayName || post.username}'s post on Nova Buzz`,
            description: post.content.substring(0, 200) + (post.content.length > 200 ? '...' : ''),
            url: `https://buzz.nova.xxavvgroup.com/post/${postId}`,
            image: post.profilePicUrl || 'https://buzz.nova.xxavvgroup.com/images/default-post.jpg',
            type: 'article',
            site_name: 'Nova Buzz',
            creator: `@${post.username}`,
            created_at: post.createdAt.toDate().toISOString()
        };
    }

    static generateProfileEmbed(userData, userId) {
        return {
            title: `${userData.displayName || userData.username} on Nova Buzz`,
            description: `Follow ${userData.displayName || userData.username} on Nova Buzz`,
            url: `https://buzz.nova.xxavvgroup.com/profile/${userId}`,
            image: userData.profilePicUrl || 'https://buzz.nova.xxavvgroup.com/images/default-avatar.jpg',
            type: 'profile',
            site_name: 'Nova Buzz',
            username: `@${userData.username}`,
            verified: userData.isVerified || false
        };
    }

    static updateMetaTags(embedData) {
        // Basic SEO
        document.title = embedData.title;
        document.querySelector('meta[name="description"]').content = embedData.description;

        // Open Graph
        document.querySelector('meta[property="og:title"]').content = embedData.title;
        document.querySelector('meta[property="og:description"]').content = embedData.description;
        document.querySelector('meta[property="og:url"]').content = embedData.url;
        document.querySelector('meta[property="og:image"]').content = embedData.image;
        document.querySelector('meta[property="og:type"]').content = embedData.type;
        document.querySelector('meta[property="og:site_name"]').content = embedData.site_name;

        // Twitter Card
        document.querySelector('meta[name="twitter:title"]').content = embedData.title;
        document.querySelector('meta[name="twitter:description"]').content = embedData.description;
        document.querySelector('meta[name="twitter:image"]').content = embedData.image;
        document.querySelector('meta[name="twitter:creator"]').content = embedData.creator || embedData.username;
    }
}
