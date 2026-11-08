export function createAssistantReply({ apiKey, model, instructions, fetchImpl = fetch }) {
  if (!apiKey || !model || !instructions) throw Error('assistant_settings_missing');

  return async function reply(input) {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ model, instructions, input, store: false, max_output_tokens: 1200 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error('assistant_provider_' + response.status);
    const data = await response.json();
    const text = (data.output ?? [])
      .filter(item => item.type === 'message' && item.role === 'assistant')
      .flatMap(item => item.content)
      .filter(part => part.type === 'output_text' || part.type === 'refusal')
      .map(part => part.text ?? part.refusal)
      .join('\n').trim();
    if (!text) throw Error('assistant_empty_reply');
    return text;
  };
}

export function createAssistantController({ telegram, reply, state, botUsername, userIds, groupIds }) {
  const users = new Set(userIds);
  const groups = new Set(groupIds);
  const username = botUsername.toLowerCase();
  const help = 'Я рабочий помощник. Напишите запрос в личке. В рабочей группе используйте /simon и текст запроса.';

  return {
    async handle({ message }) {
      const chat = message?.chat;
      const sender = message?.from;
      if (!chat || !sender || sender.is_bot) return;
      if (!users.has(sender.id) && sender.id !== state.owner?.userId) return;
      const privateChat = chat.type === 'private';
      if (!privateChat && (!['group', 'supergroup'].includes(chat.type) || !groups.has(chat.id))) return;
      const text = message.text?.trim();
      if (!text) return;
      const command = /^\/(\w+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(text);
      if (command?.[2] && command[2].toLowerCase() !== username) return;
      if (!privateChat && command?.[1] !== 'simon') return;
      const send = value => telegram('sendMessage', {
        chat_id: chat.id,
        text: value.slice(0, 4000),
        ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
        ...(!privateChat ? { reply_parameters: { message_id: message.message_id } } : {}),
      });
      if (command && (command[1] !== 'simon' || !command[3])) {
        await send(help);
        return;
      }
      const input = command ? command[3] : text;
      if (input.length > 4000) {
        await send('Сократите запрос до 4000 символов.');
        return;
      }
      let answer;
      try {
        answer = await reply(input);
      } catch (error) {
        const code = error?.message;
        console.warn('Assistant request failed:', /^assistant_provider_\d{3}$/.test(code) ? code : 'assistant_unavailable');
        answer = 'Сейчас не удалось получить ответ. Попробуйте ещё раз через минуту.';
      }
      await send(answer);
    },
  };
}

export function parseTelegramIds(value = '') {
  if (!value.trim()) return [];
  return value.split(',').map(part => {
    const id = part.trim();
    if (!/^-?[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
      throw Error('assistant_settings_missing');
    }
    return Number(id);
  });
}
