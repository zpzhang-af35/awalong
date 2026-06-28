# 评审风云

程序员主题的阿瓦隆 / 抵抗组织实时房间游戏。项目支持创建房间、邀请玩家、发放身份、组队投票、秘密任务、刺杀结算、聊天日志和同房记分。

## 技术栈

- React 19 + Vite
- TypeScript
- Fastify
- Socket.IO
- Zod
- Vitest

## 项目结构

```txt
src/
  client/          React 前端界面
  server/          Fastify + Socket.IO 服务端
  shared/          前后端共享的类型、规则和校验
```

关键文件：

- `src/client/App.tsx`：前端主界面和 Socket.IO 客户端事件。
- `src/server/index.ts`：HTTP 服务、Socket.IO 事件入口和生产静态文件托管。
- `src/server/roomStore.ts`：房间状态、游戏流程、重连、结算和计分。
- `src/shared/rules.ts`：角色、任务人数、胜负判定和私密身份信息。
- `src/shared/schemas.ts`：客户端事件 payload 校验。

## 本地开发

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

默认会同时启动：

- 前端：`http://localhost:5173`
- 服务端：`http://localhost:3001`

Vite 会把 `/socket.io` 代理到本地服务端。

## 本机多开测试

在 `localhost` 打开页面后，可以勾选「本机多开测试」。开启后，每个浏览器 tab 会使用独立 session，方便在一台电脑上模拟多个玩家跑完整局。

## 常用命令

```bash
npm test
npm run build
npm start
```

- `npm test`：运行规则和房间状态单测。
- `npm run build`：执行 TypeScript 检查并构建前端产物。
- `npm start`：以生产模式启动服务端，并托管 `dist/` 静态文件。

## 环境变量

服务端支持以下环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | 服务端监听端口 |
| `CLIENT_ORIGIN` | `http://localhost:5173` | 开发环境 Socket.IO / CORS 允许的前端地址 |
| `NODE_ENV` | - | 设置为 `production` 时，服务端会托管 `dist/` |

## 部署建议

这个项目依赖 Socket.IO 长连接，并且当前房间数据保存在服务端内存里。因此更适合部署到可以长期运行 Node 进程的平台。

推荐拆分部署：

1. 前端部署到 Vercel、Netlify 等静态站点平台。
2. 后端部署到 Render、Railway、Fly.io、Cloud Run 等支持 WebSocket 的服务。
3. 如果需要多实例、自动扩容或更稳定的重连体验，应把 `RoomStore` 从内存迁移到 Redis 等外部存储。

如果前后端分开部署，需要让前端连接后端域名。可以在客户端增加类似下面的配置：

```ts
const nextSocket = io(import.meta.env.VITE_SOCKET_URL || undefined, {
  path: "/socket.io"
});
```

然后在前端平台配置：

```txt
VITE_SOCKET_URL=https://your-api.example.com
```

后端平台配置：

```txt
NODE_ENV=production
CLIENT_ORIGIN=https://your-frontend.example.com
```

## 游戏配置

当前支持 5-10 人局，默认角色配置定义在 `src/shared/rules.ts`：

- 项目组：架构师（梅林）、技术负责人（派西维尔）、程序员等。
- 事故阵营：NPE（刺客）、假架构师（莫甘娜）、Race Condition（莫德雷德）、RuntimeError（奥伯伦）、Bug 等。

胜负规则接近标准阿瓦隆：

- 项目组完成 3 个任务后进入刺杀阶段。
- 事故阵营破坏 3 个任务直接获胜。
- 连续 5 次组队投票失败，事故阵营获胜。
- NPE 刺中架构师，事故阵营翻盘。

## 当前限制

- 房间状态仅存在内存中，服务重启会丢失房间。
- 多实例部署会导致不同玩家可能连接到不同进程，房间状态不共享。
- 目前没有持久化用户系统，依赖浏览器保存重连 token。
