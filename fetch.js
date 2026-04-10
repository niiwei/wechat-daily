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

  // 生成存档 HTML（供 index.html 存档链接使用）
  const archiveHtmlPath = path.join(archiveDir, `${fileDateStr}.html`);
  await fs.writeFile(archiveHtmlPath, generateArchiveHtml(fileDateStr), 'utf-8');
  console.log(`存档页面已生成: ${archiveHtmlPath}`);

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

// 生成存档 HTML（数据源指向对应日期的 JSON）
function generateArchiveHtml(fileDate) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>公众号订阅日报 - ${fileDate}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #f7f5f0;
      --bg-secondary: #f0ece3;
      --bg-card: #faf8f3;
      --text-primary: #1a1a1a;
      --text-secondary: #5c5c5c;
      --text-muted: #8a8a8a;
      --accent: #8b4513;
      --accent-light: #d4a574;
      --border: #d9d3c7;
      --border-dark: #b8b0a0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Source Serif 4', 'Noto Serif SC', Georgia, serif; background: var(--bg-primary); color: var(--text-primary); line-height: 1.7; min-height: 100vh; font-size: 16px; }
    .container { max-width: 900px; margin: 0 auto; padding: 60px 40px; }
    header { text-align: center; margin-bottom: 60px; padding-bottom: 40px; border-bottom: 3px double var(--border-dark); }
    .masthead { font-family: 'Playfair Display', Georgia, serif; font-size: 3.5rem; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 12px; }
    .tagline { font-family: 'Playfair Display', Georgia, serif; font-style: italic; font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 24px; }
    .edition-info { display: flex; justify-content: center; align-items: center; gap: 24px; font-size: 0.9rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; }
    .edition-info::before, .edition-info::after { content: '—'; color: var(--border-dark); }
    .back-link { display: inline-block; margin-top: 20px; color: var(--text-muted); text-decoration: none; font-size: 0.9rem; }
    .back-link:hover { color: var(--accent); }
    .overview { background: var(--bg-card); border: 1px solid var(--border); padding: 32px; margin-bottom: 60px; position: relative; text-align: center; }
    .overview::before { content: ''; position: absolute; top: 4px; left: 4px; right: 4px; bottom: 4px; border: 1px solid var(--border); pointer-events: none; }
    .overview-header { font-family: 'Playfair Display', Georgia, serif; font-size: 1.5rem; font-weight: 600; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .stats-line { font-size: 1.1rem; color: var(--text-secondary); }
    .stats-line strong { color: var(--accent); font-weight: 600; }
    .category-section { margin-bottom: 60px; }
    .category-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 2px solid var(--text-primary); }
    .category-name { font-family: 'Playfair Display', Georgia, serif; font-size: 1.5rem; font-weight: 600; }
    .category-count { font-size: 0.9rem; color: var(--text-muted); font-style: italic; }
    .article-list { list-style: none; }
    .article-item { padding: 16px 0; border-bottom: 1px dotted var(--border); }
    .article-item:last-child { border-bottom: none; }
    .article-item:hover { background: var(--bg-secondary); margin: 0 -16px; padding-left: 16px; padding-right: 16px; }
    .article-title { font-size: 1.1rem; font-weight: 600; color: var(--text-primary); text-decoration: none; display: block; line-height: 1.5; margin-bottom: 8px; }
    .article-title:hover { color: var(--accent); }
    .article-title::before { content: '› '; color: var(--accent-light); }
    .article-meta { display: flex; align-items: center; gap: 12px; font-size: 0.85rem; color: var(--text-muted); }
    .source-tag { display: inline-block; padding: 2px 10px; background: var(--bg-secondary); border: 1px solid var(--border); font-size: 0.8rem; }
    .publish-time { font-style: italic; }
    .empty-state { text-align: center; padding: 80px 40px; color: var(--text-muted); font-style: italic; }
    footer { text-align: center; padding: 40px; color: var(--text-muted); font-size: 0.85rem; font-style: italic; border-top: 1px solid var(--border); margin-top: 60px; }
    @media (max-width: 768px) { .container { padding: 40px 24px; } .masthead { font-size: 2.5rem; } }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1 class="masthead">公众号订阅日报</h1>
      <p class="tagline">每日精选 · 去芜存菁</p>
      <div class="edition-info">
        <span id="current-date">Loading...</span>
        <span>Daily Digest</span>
      </div>
      <a href="../index.html" class="back-link">← 返回存档首页</a>
    </header>
    <div id="overview"></div>
    <main id="content"></main>
    <footer><p>Generated by OpenClaw · 每日自动更新</p></footer>
  </div>
  <script>
    async function loadData() {
      try {
        const response = await fetch('./${fileDate}.json');
        const data = await response.json();
        if (data.date) document.getElementById('current-date').textContent = data.date;
        if (data.categories) {
          document.getElementById('overview').innerHTML = \`
            <div class="overview">
              <div class="overview-header">本期概览</div>
              <div class="stats-line">共收录 <strong>\${data.totalArticles}</strong> 篇文章，分为 <strong>\${data.categories.length}</strong> 个主题</div>
            </div>\`;
          document.getElementById('content').innerHTML = data.categories.map(cat => \`
            <section class="category-section">
              <div class="category-header">
                <h2 class="category-name">\${cat.name}</h2>
                <span class="category-count">\${cat.articles.length} 篇</span>
              </div>
              <ul class="article-list">
                \${cat.articles.map(a => \`
                  <li class="article-item">
                    <a href="\${a.link}" target="_blank" class="article-title">\${a.title}</a>
                    <div class="article-meta">
                      <span class="source-tag">\${a.source}</span>
                      <span class="publish-time">\${a.publishTime}</span>
                    </div>
                  </li>\`).join('')}
              </ul>
            </section>\`).join('');
        }
      } catch (e) {
        document.getElementById('content').innerHTML = '<div class="empty-state"><p>加载失败，请稍后再试</p></div>';
      }
    }
    loadData();
  </script>
</body>
</html>`;
}

main().catch(console.error);
