const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema(
    {
        full_name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        role: {
            type: String,
            enum: ['user'],
            default: 'user',
        },
        password: {
            type: String,
            required: true,
            select: false, // Exclude password by default
        },
        cvUrl: {
            type: String,
            default: null,
        },
        cvFileName: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
        collection: "users",
    }
);

// Hash password before saving
userSchema.pre("save", async function () {
    if (!this.isModified("password")) {
        return;
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.models.User || mongoose.model("User", userSchema);