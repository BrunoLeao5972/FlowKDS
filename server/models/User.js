const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      default: 'legacy',
      index: true,
    },
    username: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      minlength: 3,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    permissions: {
      type: [String],
      enum: ['admin', 'kitchen', 'display', 'settings', 'cook'],
      default: ['admin', 'kitchen', 'display', 'settings', 'cook'],
    },
  },
  {
    versionKey: false,
    collection: 'users',
  }
);

userSchema.index({ tenantId: 1, username: 1 }, { unique: true });

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  try {
    this.passwordHash = await bcrypt.hash(this.passwordHash, 10);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.passwordHash);
};

module.exports = mongoose.model('User', userSchema);
