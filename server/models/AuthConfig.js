const mongoose = require('mongoose');

const authConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true },
    passwordHash: { type: String, required: true },
    passwordSalt: { type: String, required: true },
    updatedAt: { type: Number, required: true },
  },
  {
    versionKey: false,
    collection: 'auth_configs',
  }
);

module.exports = mongoose.model('AuthConfig', authConfigSchema);
