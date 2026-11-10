# 后端运行时：本机构建好的 dist 直接打进镜像，不在服务器上编译（避免服务器多阶段构建问题）
FROM node:20-slim
# 简报 PNG 在容器内渲染；必须安装中文字体，否则只会显示色块、文字全部缺失。
RUN apt-get update \
    && apt-get install -y --no-install-recommends fontconfig fonts-noto-cjk \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --registry=https://registry.npmmirror.com
COPY dist ./dist
EXPOSE 8081
CMD ["node", "dist/main.js"]
