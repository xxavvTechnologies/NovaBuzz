import cron from 'node-cron';
import { exec } from 'child_process';

// Run every day at midnight
cron.schedule('0 0 * * *', () => {
    exec('npm run generate-sitemap', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error running sitemap generator: ${error}`);
            return;
        }
        console.log(`Sitemap generated: ${stdout}`);
    });
});
