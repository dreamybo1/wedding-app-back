require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const Guest = require("./models/Guest");

const app = express();
app.use(cors());
app.use(express.json());

// Подключение к MongoDB Atlas из .env файла
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("🌱 Успешное подключение к MongoDB"))
  .catch((err) => console.error("❌ Ошибка MongoDB:", err));

// Обработчик формы с фронтенда
app.post("/api/rsvp", async (req, res) => {
  try {
    const { guestSlug, title, coming, menu, drinks, song } = req.body;

    if (!guestSlug) {
      return res
        .status(400)
        .json({ success: false, error: "Отсутствует guestSlug" });
    }

    // Сохраняем или обновляем запись в MongoDB
    const guestData = {
      title: title || "Уважаемый гость",
      coming: coming || "no",
      menu: menu || "—",
      drinks: drinks || "—",
      song: song || "—",
      updatedAt: new Date(),
    };

    // findByIdAndUpdate с опцией upsert:true создаст запись, если её нет, или обновит старую
    const updatedGuest = await Guest.findByIdAndUpdate(guestSlug, guestData, {
      new: true,
      upsert: true,
    });

    // Формируем текст сообщения для вашего Telegram канала/чата
    const tgMessage =
      `🌸 **Ответ на приглашение**\n\n` +
      `👤 **Гость:** ${updatedGuest.title} (${guestSlug})\n` +
      `✅ **Придут:** ${updatedGuest.coming === "yes" ? "Да 🎉" : "Нет 😔"}\n` +
      `🍽 **Меню:** ${updatedGuest.menu}\n` +
      `🍷 **Напитки:** ${updatedGuest.drinks}\n` +
      `🎵 **Песня:** ${updatedGuest.song}`;

    // Отправляем уведомление в Telegram (токены теперь лежат в безопасности на бэке)
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: tgMessage,
        parse_mode: "Markdown",
      }
    );

    // Возвращаем фронтенду успешный статус
    res.status(200).json({ success: true, guest: updatedGuest });
  } catch (error) {
    console.error("Ошибка при обработке RSVP:", error);
    res
      .status(500)
      .json({ success: false, error: "Внутренняя ошибка сервера" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Бэкенд-сервер запущен на порту ${PORT}`);
});
