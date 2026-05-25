require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api"); // Добавили библиотеку
const Guest = require("./models/Guest");

const app = express();
app.use(cors());
app.use(express.json());

// Подключение к MongoDB Atlas
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("🌱 Успешное подключение к MongoDB"))
  .catch((err) => console.error("❌ Ошибка MongoDB:", err));

// Инициализация Telegram-бота (включаем polling для чтения сообщений)
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Функция для генерации Главного Меню (обычные текстовые кнопки)
const sendMainMenu = (
  chatId,
  text = "Добро пожаловать в свадебный менеджер! Выберите действие:"
) => {
  bot.sendMessage(chatId, text, {
    reply_markup: {
      keyboard: [[{ text: "📋 Список гостей" }]],
      resize_keyboard: true,
    },
  });
};

// --- ЛОГИКА ТЕЛЕГРАМ-БОТА ---

// Обработка текстовых команд (/start и кнопка меню)
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === "/start" || text === "↩️ Главное меню") {
    return sendMainMenu(chatId);
  }

  if (text === "📋 Список гостей") {
    try {
      const guests = await Guest.find({});

      if (guests.length === 0) {
        return bot.sendMessage(chatId, "Список гостей пока пуст.");
      }

      // Создаем инлайн-кнопки (под сообщением) для каждого гостя
      const keyboard = guests.map((guest) => {
        const statusEmoji = guest.coming === "yes" ? "✅" : "❌";
        return [
          {
            text: `${statusEmoji} ${guest.title}`,
            callback_data: `view_${guest._id}`, // Передаем ID (slug) гостя
          },
        ];
      });

      bot.sendMessage(chatId, "Выберите гостя для просмотра деталей:", {
        reply_markup: {
          inline_keyboard: keyboard,
        },
      });
    } catch (error) {
      console.error("Ошибка при получении списка гостей:", error);
      bot.sendMessage(chatId, "⚠️ Не удалось загрузить список гостей.");
    }
  }
});

// Обработка нажатий на инлайн-кнопки (Callback Queries)
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;

  // Если нажата кнопка возврата к списку из карточки гостя
  if (data === "back_to_list") {
    try {
      const guests = await Guest.find({});
      const keyboard = guests.map((guest) => {
        const statusEmoji = guest.coming === "yes" ? "✅" : "❌";
        return [
          {
            text: `${statusEmoji} ${guest.title}`,
            callback_data: `view_${guest._id}`,
          },
        ];
      });

      // Редактируем старое сообщение, чтобы не спамить в чате
      await bot.editMessageText("Выберите гостя для просмотра деталей:", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      bot.sendMessage(chatId, "⚠️ Ошибка обновления списка.");
    }
    return bot.answerCallbackQuery(callbackQuery.id);
  }

  // Если нажата кнопка конкретного гостя (начинается с view_)
  if (data.startsWith("view_")) {
    const guestSlug = data.split("_")[1];

    try {
      const guest = await Guest.findById(guestSlug);

      if (!guest) {
        return bot.sendMessage(chatId, "Гость не найден в базе.");
      }

      const guestCard =
        `👤 **Карточка гостя: ${guest.title}**\n` +
        `🆔 URL-slug: \`${guestSlug}\`\n\n` +
        `✅ **Придет:** ${guest.coming === "yes" ? "Да 🎉" : "Нет 😔"}\n` +
        `🍽 **Меню:** ${guest.menu}\n` +
        `🍷 **Напитки:** ${guest.drinks}\n` +
        `🎵 **Песня:** ${guest.song}`;

      // Кнопка под карточкой для быстрого возврата назад к списку
      const inlineKeyboard = [
        [{ text: "⬅️ Назад к списку", callback_data: "back_to_list" }],
      ];

      await bot.editMessageText(guestCard, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: inlineKeyboard },
      });
    } catch (error) {
      console.error("Ошибка при просмотре гостя:", error);
      bot.sendMessage(chatId, "⚠️ Не удалось загрузить карточку гостя.");
    }
    return bot.answerCallbackQuery(callbackQuery.id);
  }
});

// --- API ДЛЯ ФРОНТЕНДА ---

app.post("/api/rsvp", async (req, res) => {
  try {
    const { guestSlug, title, coming, menu, drinks, song } = req.body;

    if (!guestSlug) {
      return res
        .status(400)
        .json({ success: false, error: "Отсутствует guestSlug" });
    }

    const guestData = {
      title: title || "Уважаемый гость",
      coming: coming || "no",
      menu: menu || "—",
      drinks: drinks || "—",
      song: song || "—",
      updatedAt: new Date(),
    };

    const updatedGuest = await Guest.findByIdAndUpdate(guestSlug, guestData, {
      new: true,
      upsert: true,
    });

    const tgMessage =
      `🌸 **Ответ на приглашение**\n\n` +
      `👤 **Гость:** ${updatedGuest.title} (${guestSlug})\n` +
      `✅ **Придут:** ${updatedGuest.coming === "yes" ? "Да 🎉" : "Нет 😔"}\n` +
      `🍽 **Меню:** ${updatedGuest.menu}\n` +
      `🍷 **Напитки:** ${updatedGuest.drinks}\n` +
      `🎵 **Песня:** ${updatedGuest.song}`;

    // Отправка моментального уведомления в ваш канал или личный чат
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: tgMessage,
        parse_mode: "Markdown",
      }
    );

    res.status(200).json({ success: true, guest: updatedGuest });
  } catch (error) {
    console.error("Ошибка при обработке RSVP:", error);
    res
      .status(500)
      .json({ success: false, error: "Внутренняя ошибка сервера" });
  }
});

// Новый GET-эндпоинт для проверки активности (для cron-job.org)
app.get("/api/health", (req, res) => {
  res
    .status(200)
    .json({ status: "alive", message: "Wedding backend is working" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Бэкенд-сервер запущен на порту ${PORT}`);
});
