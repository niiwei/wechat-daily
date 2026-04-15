/**
 * 补跑历史存档脚本
 * 用法: node fetch-backfill.js 2026-04-10
 */
const Parser = require('rss-parser');
const fs = require('fs').promises;
const path = require('path');

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

const RSS_FEEDS = [
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_3934419561.atom',
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_3223096120.atom',
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_2399106260.atom',
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_1304308441.atom',
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_3632798583.atom',
  'https://wewe-rss-production-d836.up.railway.app/feeds/MP_WXS_3264997043.atom'
];

const CATEGORY_RULES = [
  { name: 'AI前沿', keywords: ['GPT', 'Claude', 'OpenAI', 'Anthropic', '大模型', 'LLM', '模型订阅', 'AI公司', 'AI数字人', '年化贡献'] },
  { name: 'AI产品', keywords: ['AI产品', 'Agent', '智能体', 'Skill', 'AI应用', '可灵', '产品方法论', 'TOKEN', 'AI工具', 'AI提效'] },
  { name: '商业洞察', keywords: ['企业', '商业', '行业', '职场', '年薪', '月薪', '招聘', '红利', '战略', '小米', '蒙牛', '马云', '微软'] },
  { name: '技术开源', keywords: ['开源', 'GitHub', 'Linux', '开发者', '代码', 'GLM', '技术工具'] }
];

function categorizeArticle(title) {
  const titleLower = title.toLowerCase();
  for (const category of CATEGORY_RULES) {
    for (const keyword of category.keywords) {
      if (titleLower.includes(keyword.toLowerCase())) return category.name;
    }
  }
  return '其他';
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function getAccountName(feedUrl, feed) {
  if (feed && feed.title) return feed.title.replace(/[\s-]*RSS[\s-]*/i, '').trim();
  const match = feedUrl.match(/MP_WXS_(\d+)/);
  if (match) return `公众号_${match[1]}`;
  return '未知公众号';
}

// 判断是否属于指定日期当天
function isOnDate(date, targetDate) {
  const articleDate = new Date(date);
  const start = new Date(targetDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(targetDate);
  end.setHours(23, 59, 59, 999);
  return articleDate >= start && articleDate <= end;
}

async function updateIndex(archiveDir, fileDate, displayDate, articleCount) {
  const indexPath = path.join(archiveDir, 'index.json');
  let index = { archives: [] };
  try {
    const existing = await fs.readFile(indexPath, 'utf-8');
    index = JSON.parse(existing);
  } catch (e) {}

  const exists = index.archives.find(a => a.fileDate === fileDate);
  if (!exists) {
    index.archives.unshift({ fileDate, displayDate, articleCount, url: `./archive/${fileDate}.json` });
    index.archives.sort((a, b) => b.fileDate.localeCompare(a.fileDate));
  } else {
    // 更新 articleCount
    exists.articleCount = articleCount;
  }
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

async function backfill(targetDateStr) {
  const targetDate = new Date(targetDateStr);
  if (isNaN(targetDate.getTime())) {
    console.error(`无效日期: ${targetDateStr}`);
    process.exit(1);
  }

  const fileDateStr = targetDateStr; // 已是 YYYY-MM-DD
  const displayDate = formatDate(targetDate);

  console.log(`补跑日期: ${displayDate}`);

  const allFeeds = await Promise.all(RSS_FEEDS.map(async url => {
    try {
      console.log(`Fetching: ${url}`);
      return await parser.parseURL(url);
    } catch (e) {
      console.error(`Failed: ${url} — ${e.message}`);
      return null;
    }
  }));

  const validFeeds = allFeeds.filter(Boolean);
  console.log(`成功获取 ${validFeeds.length}/${RSS_FEEDS.length} 个公众号`);

  const articles = [];
  for (const feed of validFeeds) {
    const accountName = getAccountName(feed.feedUrl || feed.link, feed);
    for (const item of feed.items) {
      const pubDate = item.pubDate || item.isoDate;
      if (pubDate && isOnDate(pubDate, targetDate)) {
        const category = categorizeArticle(item.title);
        console.log(`  [${category}] ${item.title.substring(0, 50)}`);
        articles.push({
          title: item.title,
          link: item.link,
          source: accountName,
          category,
          publishTime: formatTime(pubDate),
          pubDate: new Date(pubDate)
        });
      }
    }
  }

  console.log(`\n找到 ${articles.length} 篇文章`);

  const categoryGroups = {};
  articles.forEach(a => {
    if (!categoryGroups[a.category]) categoryGroups[a.category] = [];
    categoryGroups[a.category].push(a);
  });

  const dailyData = {
    generatedAt: new Date().toISOString(),
    date: displayDate,
    fileDate: fileDateStr,
    totalArticles: articles.length,
    categories: Object.entries(categoryGroups).map(([name, arts]) => ({
      name,
      articles: arts.sort((a, b) => b.pubDate - a.pubDate)
    })).sort((a, b) => b.articles.length - a.articles.length)
  };

  const archiveDir = path.join(__dirname, 'archive');
  await fs.mkdir(archiveDir, { recursive: true });

  const archivePath = path.join(archiveDir, `${fileDateStr}.json`);
  await fs.writeFile(archivePath, JSON.stringify(dailyData, null, 2), 'utf-8');
  console.log(`存档已写入: ${archivePath}`);

  await updateIndex(archiveDir, fileDateStr, displayDate, articles.length);
  console.log(`索引已更新`);
}

const targetDate = process.argv[2];
if (!targetDate) {
  console.error('用法: node fetch-backfill.js 2026-04-10');
  process.exit(1);
}

backfill(targetDate).catch(console.error);
