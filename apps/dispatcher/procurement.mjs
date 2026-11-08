import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createProcurementController({ telegram, owner, botUsername, userIds, groupIds, journalDir }) {
  if (!owner) throw Error('assistant_settings_missing');
  const users = new Set([owner.userId, ...userIds]);
  const groups = new Set(groupIds);
  const pending = new Map();
  const help = 'Отправьте заявку одним сообщением. Можно приложить фото или документ. В рабочей группе начните сообщение с /simon.';
  await mkdir(journalDir, { recursive: true, mode: 0o700 });

  async function readEntry(id) {
    try {
      return JSON.parse(await readFile(join(journalDir, id + '.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async function saveEntry(entry) {
    const path = join(journalDir, entry.id + '.json');
    const temp = path + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temp, JSON.stringify(entry) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  }

  async function readJournal() {
    const entries = [];
    for (const name of await readdir(journalDir)) {
      if (/^[a-f0-9]{16}\.json$/.test(name)) entries.push(await readEntry(name.slice(0, -5)));
    }
    return entries;
  }

  async function deliver(entry) {
    const chat_id = owner.chatId;
    const title = 'Заявка №' + entry.id + ' от ' + entry.author;
    const attachment = entry.attachment;
    if (attachment) {
      const caption = title + (entry.text ? '\n\n' + entry.text : '');
      if (caption.length > 1024) await telegram('sendMessage', { chat_id, text: title });
      await telegram(attachment.method, {
        chat_id, [attachment.field]: attachment.fileId,
        caption: caption.length > 1024 ? entry.text : caption,
      });
      return;
    }
    const body = title + '\n\n' + entry.text;
    if (body.length > 4096) {
      await telegram('sendMessage', { chat_id, text: title });
      await telegram('sendMessage', { chat_id, text: entry.text });
      return;
    }
    await telegram('sendMessage', { chat_id, text: body });
  }

  for (const entry of await readJournal()) {
    if (entry.notificationPending) pending.set(entry.id, entry);
  }

  return {
    async flushNotifications() {
      for (const entry of [...pending.values()].slice(0, 10)) {
        try {
          await deliver(entry);
          await saveEntry({ ...entry, notificationPending: false });
          pending.delete(entry.id);
        } catch {
          pending.delete(entry.id);
          pending.set(entry.id, entry);
          console.warn('Procurement notification pending:', entry.id);
        }
      }
    },

    async handle({ message }) {
      const chat = message?.chat;
      const sender = message?.from;
      if (!chat || !sender || sender.is_bot || !users.has(sender.id)) return;
      const privateChat = chat.type === 'private';
      if (!privateChat && (!['group', 'supergroup'].includes(chat.type) || !groups.has(chat.id))) return;
      const ownerChat = privateChat && chat.id === owner.chatId && sender.id === owner.userId;
      const source = (message.text ?? message.caption ?? '').trim();
      const command = /^\/(\w+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(source);
      if (command?.[2] && command[2].toLowerCase() !== botUsername.toLowerCase()) return;
      if (!privateChat && command?.[1] !== 'simon') return;
      const send = text => telegram('sendMessage', {
        chat_id: chat.id,
        text,
        ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
      });

      if (ownerChat && command?.[1] === 'requests') {
        const entries = (await readJournal()).sort((a, b) => b.date - a.date || b.messageId - a.messageId).slice(0, 10);
        const lines = entries.map(entry => '№' + entry.id + ' · ' + (entry.text.replace(/\s+/g, ' ').slice(0, 140) || 'Вложение'));
        await send(lines.length ? 'Последние заявки\n\n' + lines.join('\n') + '\n\nОткрыть заявку: /request НОМЕР' : 'Журнал пока пуст.');
        return;
      }
      if (ownerChat && command?.[1] === 'request') {
        const id = command[3]?.trim().toLowerCase();
        const entry = id && /^[a-f0-9]{16}$/.test(id) ? await readEntry(id) : null;
        if (entry) await deliver(entry);
        else await send('Заявка не найдена. Список заявок: /requests');
        return;
      }
      if (command && command[1] !== 'simon') {
        await send(help + (ownerChat ? ' Журнал: /requests.' : ''));
        return;
      }

      const photo = message.photo?.at(-1);
      const document = message.document;
      const attachment = photo ? { method: 'sendPhoto', field: 'photo', fileId: photo.file_id }
        : document ? { method: 'sendDocument', field: 'document', fileId: document.file_id } : null;
      const text = command ? (command[3] ?? '').trim() : source;
      if (!text && !attachment) {
        await send(help);
        return;
      }

      const id = createHash('sha256').update(chat.id + '/' + message.message_id).digest('hex').slice(0, 16);
      let entry = await readEntry(id);
      if (!entry) {
        entry = {
          id, date: message.date, chatId: chat.id, messageId: message.message_id, senderId: sender.id,
          author: [sender.first_name, sender.last_name, sender.username && '@' + sender.username].filter(Boolean).join(' ') || 'Telegram ' + sender.id,
          text, attachment, notificationPending: !ownerChat,
        };
        await saveEntry(entry);
      }
      if (entry.notificationPending) pending.set(id, entry);
      try {
        await send('Заявка №' + id + ' принята.');
      } catch {
        console.warn('Procurement acknowledgement unavailable:', id);
      }
    },
  };
}
