function detail(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : '未知错误';
}

export function startupErrorMessage(error: unknown) {
  const message = detail(error);
  if (message.includes('encryption key is missing')) {
    return '加密密钥文件缺失。请恢复原来的 tooku-secret.key，或检查 TOOKU_SECRET_KEY_FILE 指向的文件；不要删除安全数据库或生成新密钥。';
  }
  if (message.includes('Invalid Tooku encryption key file')) {
    return '加密密钥文件无效，必须是原部署生成的 32 字节密钥。请从同一份备份恢复密钥和安全数据库。';
  }
  if (message.includes('cannot be decrypted with this key')) {
    return '加密密钥与安全数据库不匹配，或安全记录已经损坏。请从同一份备份恢复 tooku-security.sqlite 和密钥文件。';
  }
  if (message.includes('Unsupported Tooku security database version')) {
    return '安全数据库版本高于当前 Tooku 支持范围。请使用创建该数据库的同版或更新版本；回滚时必须同时恢复数据库和密钥。';
  }
  if (message.includes('Unsupported Tooku database version')) {
    return '用户数据库版本高于当前 Tooku 支持范围。请使用创建该数据库的同版或更新版本，或恢复升级前的完整数据库备份。';
  }
  if (/database disk image is malformed|SQLITE_CORRUPT|file is not a database/i.test(message)) {
    return 'SQLite 数据库无法读取。请保留当前数据目录并从完整备份恢复，不要让空数据库覆盖原文件。';
  }
  return `启动数据检查失败：${message}`;
}
