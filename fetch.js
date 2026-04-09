const Parser = require('rss-parser');
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

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

// 分类规则 - 基于关键词匹配
const CATEGORY_RULES = [
  {
    name: 'AI前沿',
    keywords: ['GPT', 'Claude', 'OpenAI', 'Anthropic', '大模型', 'LLM', '模型订阅', 'AI公司', 'AI数字人', '年化贡献']
  },
  {
    name: 'AI产品',
    keywords: ['AI产品', 'Agent', '智能体', 'Skill', 'AI应用', '可灵', '产品方法论', 'TOKEN', 'AI工具', 'AI提效']
  },
  {
    name: '商业洞察',
    keywords: ['企业', '商业', '行业', '职场', '年薪', '月薪', '招聘', '红利', '战略', '小米', '蒙牛', '马云', '微软']
  },
  {
    name: '技术开源',
    keywords: ['开源', 'GitHub', 'Linux', '开发者', '代码', 'GLM', '技术工具']
  }
];

// 根据标题分类
function categorizeArticle(title) {
  const titleLower = title.toLowerCase();

  for (const category of CATEGORY_RULES) {
    for (const keyword of category.keywords) {
      if (titleLower.includes(keyword.toLowerCase())) {
        return category.name;
      }
    }
  }

  // 默认分类
  return '其他';
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

// 格式化日期（用于文件名）
function formatDateForFile(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 格式化时间
function formatTime(date) {
  return new Date(date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// 获取公众号名称
function getAccountName(feedUrl, feed) {
  if (feed && feed.title) {
    return feed.title.replace(/[\s-]*RSS[\s-]*/i, '').trim();
  }
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
        const category = categorizeArticle(item.title);
        console.log(`  [${category}] ${item.title.substring(0, 50)}...`);

        yesterdayArticles.push({
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

  console.log(`\n找到 ${yesterdayArticles.length} 篇昨天发布的文章`);

  // 按分类分组
  const categoryGroups = {};
  yesterdayArticles.forEach(article => {
    if (!categoryGroups[article.category]) {
      categoryGroups[article.category] = [];
    }
    categoryGroups[article.category].push(article);
  });

  // 构建数据结构
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = formatDate(yesterday);
  const fileDateStr = formatDateForFile(yesterday);

  const dailyData = {
    generatedAt: new Date().toISOString(),
    date: dateStr,
    fileDate: fileDateStr,
    totalArticles: yesterdayArticles.length,
    categories: Object.entries(categoryGroups).map(([name, articles]) => ({
      name,
      articles: articles.sort((a, b) => b.pubDate - a.pubDate)
    })).sort((a, b) => b.articles.length - a.articles.length)
  };

  // 确保目录存在
  const dataDir = path.join(__dirname, 'data');
  const archiveDir = path.join(__dirname, 'archive');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(archiveDir, { recursive: true });

  // 保存到 data/daily.json（当前展示用）
  const outputPath = path.join(dataDir, 'daily.json');
  await fs.writeFile(outputPath, JSON.stringify(dailyData, null, 2), 'utf-8');
  console.log(`\n当前数据已保存到: ${outputPath}`);

  // 保存到 archive/YYYY-MM-DD.json（历史存档）
  const archivePath = path.join(archiveDir, `${fileDateStr}.json`);
  await fs.writeFile(archivePath, JSON.stringify(dailyData, null, 2), 'utf-8');
  console.log(`历史数据已保存到: ${archivePath}`);

  // 更新索引文件
  await updateIndex(archiveDir, fileDateStr, dateStr, yesterdayArticles.length);

  console.log('抓取完成!');
}

// 更新索引文件
async function updateIndex(archiveDir, fileDate, displayDate, articleCount) {
  const indexPath = path.join(archiveDir, 'index.json');
  let index = { archives: [] };

  try {
    const existing = await fs.readFile(indexPath, 'utf-8');
    index = JSON.parse(existing);
  } catch (e) {
    // 文件不存在，使用默认值
  }

  // 检查是否已存在
  const exists = index.archives.find(a => a.fileDate === fileDate);
  if (!exists) {
    index.archives.unshift({
      fileDate,
      displayDate,
      articleCount,
      url: `./archive/${fileDate}.json`
    });
    // 按日期排序
    index.archives.sort((a, b) => b.fileDate.localeCompare(a.fileDate));
  }

  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  console.log(`索引已更新: ${indexPath}`);
}

main().catch(console.error);
