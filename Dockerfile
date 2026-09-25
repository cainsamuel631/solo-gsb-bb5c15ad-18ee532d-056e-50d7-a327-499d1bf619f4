# 过敏原残留追踪 —— 生产镜像
# 单阶段即可：仅一个生产依赖（express），启动时自动初始化数据文件
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

# 先拷贝依赖清单，利用层缓存安装生产依赖
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 拷贝应用源码
COPY server.js ./
COPY src ./src
COPY public ./public

# 数据目录由命名卷挂载；node 用户对新建命名卷拥有写权限
RUN mkdir -p /app/data && chown -R node:node /app
USER node

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
