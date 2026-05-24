const mongoose = require("mongoose");

const guestSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // Сюда запишется guestSlug (например, "alex")
    title: { type: String, default: "Уважаемый гость" },
    coming: { type: String, enum: ["yes", "no"], default: "no" },
    menu: { type: String, default: "—" },
    drinks: { type: String, default: "—" },
    song: { type: String, default: "—" },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

module.exports = mongoose.model("Guest", guestSchema);
