@echo off
REM 启动本地 NATS（带 JetStream），凭据与 .env.local / scripts/nats-server.conf 对应
REM 前提：nats-server.exe 已在 PATH，或与本文件同目录
REM 下载：winget install nats-io.nats-server   或   https://github.com/nats-io/nats-server/releases
nats-server.exe -p 4222 -user app -pass local-nats-password --jetstream
