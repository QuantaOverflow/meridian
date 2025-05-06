// 直接测试 Cloudflare Browser Rendering API
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// 添加这些行获取当前文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config();
 
// 定义 Cloudflare API 响应类型，使 TypeScript 类型检查通过
interface CloudflareApiResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: string;
  messages?: string[];
}

/**
 * 直接测试 Cloudflare Browser Rendering API
 */
async function testCloudflareAPI() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
  
  if (!accountId || !apiToken) {
    console.error('❌ 缺少必要的环境变量!');
    return;
  }
  
  console.log('===== Cloudflare Browser Rendering API 直接测试 =====');
  console.log(`账号 ID: ${accountId.substring(0, 4)}...`);
  console.log(`API 令牌长度: ${apiToken.length}字符`);
  
  // 创建测试结果日志文件夹
  const logDir = path.join(__dirname, '../../../logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  // 测试网址
  const testUrl = 'https://example.com';
  
  try {
    console.log(`\n正在请求网页: ${testUrl}`);
    
    // 发起 API 请求
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          url: testUrl,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          setExtraHTTPHeaders: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          gotoOptions: {
            waitUntil: 'networkidle0',
            timeout: 30000,
            referer: 'https://www.google.com/',
          },
          bestAttempt: true,
        }),
      }
    );
    
    // 检查响应状态
    console.log('HTTP 状态码:', response.status);
    
    // 获取响应内容
    const contentType = response.headers.get('content-type') || '';
    console.log('Content-Type:', contentType);
    
    if (contentType.includes('application/json')) {
      // JSON 响应 (可能是错误信息)
      const responseText = await response.text();
      console.log('原始响应:', responseText.slice(0, 500) + (responseText.length > 500 ? '...' : ''));
      
      try {
        // 使用类型断言处理 JSON 解析
        const data = JSON.parse(responseText) as CloudflareApiResponse;
        console.log('API 响应:', JSON.stringify(data, null, 2));
        
        // 检查是否成功
        if (data.success) {
          console.log('✅ API 调用成功!');
          
          // 如果结果是 HTML 内容
          if (typeof data.result === 'string') {
            // 保存 HTML 内容
            const htmlPath = path.join(logDir, 'cf-browser-result.html');
            fs.writeFileSync(htmlPath, data.result);
            console.log(`已保存 HTML 到: ${htmlPath}`);
            console.log('HTML 内容长度:', data.result.length);
          }
        } else {
          console.error('❌ API 调用失败:', data.errors || '未知错误');
        }
      } catch (jsonError) {
        console.error('解析 JSON 响应失败:', jsonError);
        
        // 保存原始响应内容
        const errorPath = path.join(logDir, 'cf-error-response.txt');
        fs.writeFileSync(errorPath, responseText);
        console.log(`已保存错误响应到: ${errorPath}`);
      }
    } else {
      // 非 JSON 响应 (可能直接是 HTML)
      const text = await response.text();
      
      // 保存响应内容
      const responsePath = path.join(logDir, 'cf-response.txt');
      fs.writeFileSync(responsePath, text);
      console.log(`已保存响应内容到: ${responsePath}`);
      console.log('响应内容长度:', text.length);
      
      if (text.includes('<html') || text.includes('<HTML')) {
        console.log('✅ 获取到 HTML 内容!');
      } else {
        console.log('⚠️ 响应不是 HTML 格式');
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ 请求发生异常:', error);
    return false;
  }
}

// 执行测试
testCloudflareAPI()
  .then(success => {
    console.log(`\n测试${success ? '完成' : '失败'}`);
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('测试过程中发生未捕获的异常:', error);
    process.exit(1);
  });