#!/usr/bin/env node
/**
 * Summarizer Subagent - 文章摘要生成器
 * 接收文章标题和内容，返回核心摘要
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 读取输入
let inputData = '';
rl.on('line', (line) => {
  inputData += line;
});

rl.on('close', () => {
  try {
    const { title, content, link } = JSON.parse(inputData);
    const summary = generateSummary(title, content);
    console.log(JSON.stringify({ summary }));
  } catch (error) {
    console.log(JSON.stringify({
      summary: '摘要生成失败，请查看原文',
      error: error.message
    }));
  }
});

/**
 * 生成文章摘要
 * 策略：
 * 1. 提取文章核心观点（首段、结论段）
 * 2. 识别关键信息（数据、观点、结论）
 * 3. 过滤营销话术和无关内容
 */
function generateSummary(title, content) {
  if (!content || content.length < 50) {
    return content || '暂无内容';
  }

  // 清理内容
  let cleanText = content
    .replace(/\s+/g, ' ')
    .replace(/[【】\[\]]/g, '')
    .trim();

  // 分段
  const paragraphs = cleanText.split(/[。！？\n]+/).filter(p => p.trim().length > 10);

  if (paragraphs.length === 0) {
    return cleanText.substring(0, 150) + '...';
  }

  // 提取关键句
  const keySentences = [];

  // 策略1：首句通常是核心观点
  if (paragraphs[0] && paragraphs[0].length > 20) {
    keySentences.push(paragraphs[0].trim());
  }

  // 策略2：包含数字、百分比、结论性词汇的句子
  const patterns = [
    /\d+[\d,]*\.?\d*%?/,  // 数字/百分比
    /(结论|总结|建议|因此|所以|关键|核心|重要)/,  // 结论性词汇
    /(表明|显示|发现|证明|意味着)/,  // 分析性词汇
  ];

  for (const para of paragraphs.slice(1, 6)) {  // 检查前5段
    const trimmed = para.trim();
    if (trimmed.length > 15 && trimmed.length < 200) {
      const hasPattern = patterns.some(p => p.test(trimmed));
      if (hasPattern && !keySentences.includes(trimmed)) {
        keySentences.push(trimmed);
      }
    }
    if (keySentences.length >= 3) break;
  }

  // 策略3：如果没有足够的关键句，取前两句
  if (keySentences.length < 2 && paragraphs.length > 1) {
    const second = paragraphs[1].trim();
    if (second.length > 15 && !keySentences.includes(second)) {
      keySentences.push(second);
    }
  }

  // 组合摘要
  let summary = keySentences.join('。');

  // 限制长度
  const maxLength = 180;
  if (summary.length > maxLength) {
    summary = summary.substring(0, maxLength);
    // 找到最后一个句号
    const lastPeriod = summary.lastIndexOf('。');
    if (lastPeriod > maxLength * 0.7) {
      summary = summary.substring(0, lastPeriod + 1);
    } else {
      summary = summary.substring(0, maxLength - 3) + '...';
    }
  }

  return summary;
}
