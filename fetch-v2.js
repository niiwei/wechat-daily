const Parser = require('rss-parser');
const fs = require('fs').promises;
const path = require('path');
const { spawnSubagent } = require('./subagent-helper');

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

// 订阅的公众号 RSS 列表
const RSS_FEEDS = [
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_3934419561.atom',
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_3223096120.atom',
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_2399106260.atom',
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_1304308441.atom',
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_3632798583.atom',
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_3264997043.atom'
];

// 过滤广告和无关内容的正则
const AD_PATTERNS = [
  /扫码关注/g, /点击.*关注/g, /阅读原文/g, /点赞.*在看/g,
  /分享.*朋友圈/g, /广告/g, /推广/g, /商务合作/g, /投稿/g,
  /招聘/g, /简历.*投递/g, /福利.*领取/g, /限时.*优惠/g,
  /点击下方/g, /长按识别/g, /二维码/g, /关注.*公众号/g,
  /置顶.*公众号/g, /星标.*公众号/g, /转发.*好友/g
];

// 提取核心内容
function extractCoreContent(content) {
  if (!content) return '';
  let text = content.replace(/<[^>]+>/g, ' ');
  AD_PATTERNS.forEach(pattern => { text = text.replace(pattern, ''); });
  text = text.replace(/\s+/g, ' ').trim();
  const maxLength = 500;
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '...';
  }
  return text;
}

// 判断是否为昨天发布的文章
function isYesterday(date) {
  const articleDate = new Date(date);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return articleDate >= yesterday && articleDate < today;
}

// 格式化日期
function formatDate(date) {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
}

// 格式化时间
function formatTime(date) {
  return new Date(date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// 获取公众号名称
function getAccountName(feedUrl, feed) {
  if (feed && feed.title) return feed.title;
  const match = feedUrl.match(/MP_WXS_(\d+)/);
  if (match) return `公众号_${match[1]}`;
  return '未知公众号';
}

// 抓取单个 RSS
async function fetchFeed(url) {
  try {
    console.log(`Fetching: ${url}`);
    const feed = await parser.parseURL(url);
    return feed;
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error.message);
    return null;
  }
}

// 使用 subagent 生成文章摘要
async function summarizeArticle(title, content, link) {
  try {
    const cleanContent = extractCoreContent(content);
    if (!cleanContent || cleanContent.length < 100) {
      return cleanContent || '暂无摘要';
    }

    // 调用 summarizer subagent
    const result = await spawnSubagent('summarizer', {
      title,
      content: cleanContent,
      link
    });

    return result.summary || cleanContent.substring(0, 200) + '...';
  } catch (error) {
    console.error(`Summarize failed for ${title}:`, error.message);
    const fallback = extractCoreContent(content);
    return fallback.substring(0, 200) + '...';
  }
}

// 主函数
async function main() {
  console.log('开始抓取公众号更新...');
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);

  const allFeeds = await Promise.all(RSS_FEEDS.map(fetchFeed));
  const validFeeds = allFeeds.filter(f => f !== null);
  console.log(`成功获取 ${validFeeds.length}/${RSS_FEEDS.length} 个公众号`);

  // 收集昨天的文章
  const yesterdayArticles = [];

  for (const feed of validFeeds) {
    const accountName = getAccountName(feed.feedUrl || feed.link, feed);
    console.log(`\n处理公众号: ${accountName}`);

    for (const item of feed.items) {
      const pubDate = item.pubDate || item.isoDate;
      if (pubDate && isYesterday(pubDate)) {
        console.log(`  正在总结: ${item.title}`);

        const summary = await summarizeArticle(
          item.title,
          item['content:encoded'] || item.content || item.contentSnippet,
          item.link
        );

        yesterdayArticles.push({
          accountName,
          title: item.title,
          link: item.link,
          summary,
          publishTime: formatTime(pubDate),
          pubDate: new Date(pubDate)
        });
      }
    }
  }

  console.log(`\n找到 ${yesterdayArticles.length} 篇昨天发布的文章`);

  // 按公众号分组
  const accountGroups = {};
  yesterdayArticles.forEach(article => {
    if (!accountGroups[article.accountName]) {
      accountGroups[article.accountName] = [];
    }
    accountGroups[article.accountName].push(article);
  });

  // 构建数据结构
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const dailyData = {
    generatedAt: new Date().toISOString(),
    days: [{
      date: formatDate(yesterday),
      totalArticles: yesterdayArticles.length,
      accounts: Object.entries(accountGroups).map(([name, articles]) => ({
        name,
        articles: articles.sort((a, b) => b.pubDate - a.pubDate)
      })).sort((a, b) => b.articles.length - a.articles.length)
    }]
  };

  // 确保目录存在
  const dataDir = path.join(__dirname, 'data');
  await fs.mkdir(dataDir, { recursive: true });

  // 保存数据
  const outputPath = path.join(dataDir, 'daily.json');
  await fs.writeFile(outputPath, JSON.stringify(dailyData, null, 2), 'utf-8');

  console.log(`\n数据已保存到: ${outputPath}`);
  console.log('抓取完成!');
}

main().catch(console.error);
