import { db } from '../js/config.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import fs from 'fs/promises';

const BASE_URL = 'https://buzz.nova.xxavvgroup.com';

async function generateSitemap() {
    try {
        // Start XML content
        let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
        sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        // Add static pages
        const staticPages = [
            '',  // Home page
            '/about',
            '/terms',
            '/privacy',
        ];

        for (const page of staticPages) {
            sitemap += `  <url>
    <loc>${BASE_URL}${page}</loc>
    <changefreq>weekly</changefreq>
    <priority>${page === '' ? '1.0' : '0.8'}</priority>
  </url>\n`;
        }

        // Add user profiles
        const users = await getDocs(collection(db, 'users'));
        for (const user of users.docs) {
            const userData = user.data();
            if (!userData.isHidden && !userData.isBanned) {
                sitemap += `  <url>
    <loc>${BASE_URL}/profile/${user.id}</loc>
    <lastmod>${userData.lastUpdated?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>\n`;
            }
        }

        // Add posts
        const posts = await getDocs(collection(db, 'posts'));
        for (const post of posts.docs) {
            const postData = post.data();
            sitemap += `  <url>
    <loc>${BASE_URL}/post/${post.id}</loc>
    <lastmod>${postData.createdAt?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>\n`;
        }

        // Add hashtag pages
        const hashtags = await getDocs(collection(db, 'hashtags'));
        for (const tag of hashtags.docs) {
            const tagData = tag.data();
            if (tagData.count > 0) {
                sitemap += `  <url>
    <loc>${BASE_URL}/tag/${tag.id}</loc>
    <lastmod>${tagData.lastUsed?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.5</priority>
  </url>\n`;
            }
        }

        // Close XML
        sitemap += '</urlset>';

        // Write to file
        await fs.writeFile('public/sitemap.xml', sitemap);
        console.log('Sitemap generated successfully!');

    } catch (error) {
        console.error('Error generating sitemap:', error);
    }
}

generateSitemap();
