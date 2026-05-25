require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");

const Guest = require("./models/Guest");

const app = express();

app.use(cors());
app.use(express.json());

// ======================================================
// MongoDB
// ======================================================

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("🌱 Успешное подключение к MongoDB");
  })
  .catch((err) => {
    console.error("❌ Ошибка MongoDB:", err);
  });

// ======================================================
// Telegram Bot (WEBHOOK)
// ======================================================

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

const webhookPath = `/bot${process.env.TELEGRAM_BOT_TOKEN}`;

const webhookUrl = `${process.env.WEBHOOK_URL}${webhookPath}`;

// Telegram webhook endpoint
app.post(webhookPath, async (req, res) => {
  // СРАЗУ отвечаем Telegram
  res.sendStatus(200);

  try {
    await bot.processUpdate(req.body);
  } catch (error) {
    console.error("❌ processUpdate error:", error);
  }
});

// Установка webhook
const initTelegramWebhook = async () => {
  try {
    // Удаляем старый webhook/polling
    await bot.deleteWebHook();

    // Устанавливаем новый webhook
    await bot.setWebHook(webhookUrl);

    console.log("✅ Telegram webhook установлен:");
    console.log(webhookUrl);
  } catch (error) {
    console.error("❌ Ошибка установки webhook:", error);
  }
};

// ======================================================
// Telegram Menu
// ======================================================

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

// ======================================================
// Telegram Bot Logic
// ======================================================

// Обработка сообщений
bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    // Главное меню
    if (text === "/start" || text === "↩️ Главное меню") {
      return sendMainMenu(chatId);
    }

    // Список гостей
    if (text === "📋 Список гостей") {
      const guests = await Guest.find({});

      if (!guests.length) {
        return bot.sendMessage(chatId, "Список гостей пока пуст.");
      }

      const keyboard = guests.map((guest) => {
        const statusEmoji = guest.coming === "yes" ? "✅" : "❌";

        return [
          {
            text: `${statusEmoji} ${guest.title}`,
            callback_data: `view_${guest._id}`,
          },
        ];
      });

      return bot.sendMessage(chatId, "Выберите гостя для просмотра деталей:", {
        reply_markup: {
          inline_keyboard: keyboard,
        },
      });
    }
  } catch (error) {
    console.error("❌ Ошибка обработки message:", error);
  }
});

// Обработка inline кнопок
bot.on("callback_query", async (callbackQuery) => {
  try {
    if (!callbackQuery?.message) {
      return bot.answerCallbackQuery(callbackQuery.id);
    }

    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    await bot.answerCallbackQuery(callbackQuery.id);

    // ==================================================
    // BACK
    // ==================================================

    if (data === "back_to_list") {
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

      try {
        await bot.editMessageText("Выберите гостя для просмотра деталей:", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: keyboard,
          },
        });
      } catch (error) {
        console.error("editMessageText error:", error);

        await bot.sendMessage(chatId, "Выберите гостя для просмотра деталей:", {
          reply_markup: {
            inline_keyboard: keyboard,
          },
        });
      }

      return;
    }

    // ==================================================
    // VIEW GUEST
    // ==================================================

    if (data.startsWith("view_")) {
      const guestId = data.replace("view_", "");

      const guest = await Guest.findById(guestId);

      if (!guest) {
        return bot.sendMessage(chatId, "Гость не найден.");
      }

      const guestCard =
        `👤 Карточка гостя: ${guest.title}\n\n` +
        `🆔 ID: ${guestId}\n\n` +
        `✅ Придет: ${guest.coming === "yes" ? "Да 🎉" : "Нет 😔"}\n` +
        `🍽 Меню: ${guest.menu || "—"}\n` +
        `🍷 Напитки: ${guest.drinks || "—"}\n` +
        `🎵 Песня: ${guest.song || "—"}`;

      const inlineKeyboard = [
        [
          {
            text: "⬅️ Назад",
            callback_data: "back_to_list",
          },
        ],
      ];

      try {
        await bot.editMessageText(guestCard, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: inlineKeyboard,
          },
        });
      } catch (error) {
        console.error("editMessageText error:", error);

        await bot.sendMessage(chatId, guestCard, {
          reply_markup: {
            inline_keyboard: inlineKeyboard,
          },
        });
      }
    }
  } catch (error) {
    console.error("❌ callback_query error:", error);
  }
});

// ======================================================
// API
// ======================================================

// RSVP submit
app.post("/api/rsvp", async (req, res) => {
  try {
    const { guestSlug, title, coming, menu, drinks, song } = req.body;

    if (!guestSlug) {
      return res.status(400).json({
        success: false,
        error: "Отсутствует guestSlug",
      });
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

    // Telegram notification
    const tgMessage =
      `🌸 *Ответ на приглашение*\n\n` +
      `👤 *Гость:* ${updatedGuest.title}\n` +
      `🆔 ID: \`${guestSlug}\`\n\n` +
      `✅ *Придут:* ${updatedGuest.coming === "yes" ? "Да 🎉" : "Нет 😔"}\n` +
      `🍽 *Меню:* ${updatedGuest.menu}\n` +
      `🍷 *Напитки:* ${updatedGuest.drinks}\n` +
      `🎵 *Песня:* ${updatedGuest.song}`;

    await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, tgMessage, {
      parse_mode: "Markdown",
    });

    return res.status(200).json({
      success: true,
      guest: updatedGuest,
    });
  } catch (error) {
    console.error("❌ Ошибка RSVP:", error);

    return res.status(500).json({
      success: false,
      error: "Внутренняя ошибка сервера",
    });
  }
});

// Получение RSVP
app.get("/api/rsvp/:guestSlug", async (req, res) => {
  try {
    const { guestSlug } = req.params;

    const guest = await Guest.findById(guestSlug);

    if (!guest) {
      return res.status(200).json({
        success: true,
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        coming: guest.coming,
        menu: guest.menu,
        drinks: guest.drinks,
        song: guest.song,
      },
    });
  } catch (error) {
    console.error("❌ Ошибка получения гостя:", error);

    return res.status(500).json({
      success: false,
      error: "Внутренняя ошибка сервера",
    });
  }
});

// Healthcheck
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "alive",
    message: "Wedding backend is working",
  });
});

// ======================================================
// Server
// ======================================================

const PORT = process.env.PORT || 3000;

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

app.listen(PORT, async () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);

  await initTelegramWebhook();
});

// ======================================================
// Graceful shutdown
// ======================================================

process.on("SIGINT", async () => {
  console.log("🛑 SIGINT");

  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM");

  process.exit(0);
});
