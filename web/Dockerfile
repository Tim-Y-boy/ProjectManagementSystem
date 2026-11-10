# 前端：本机构建好的 dist 直接放进 nginx，不在服务器上编译（避免服务器多阶段构建问题）
FROM nginx:alpine
COPY dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
