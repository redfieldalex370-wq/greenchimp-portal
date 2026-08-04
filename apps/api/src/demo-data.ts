import type { Conversation, Message } from './types.js';

const now = Date.now();
const iso = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();

const conversations: Conversation[] = [
  {
    phone_number_id: '1240006745865858',
    wa_id: '5214141047421',
    nombre: 'Tester Green Chimp',
    ultimo_texto: 'Landing',
    ultimo_mensaje: iso(-2),
    no_leidos: 1,
    bot_activo: true,
    ventana_abierta: true,
    ventana_expira: iso(24 * 60 - 2),
    tipo_ventana: 'servicio_24h',
    fuente: 'WhatsApp Directo',
    pausado_por: null,
    pausado_en: null
  },
  {
    phone_number_id: '1240006745865858',
    wa_id: '5214271364410',
    nombre: 'César R.',
    ultimo_texto: 'Me interesa un sitio web',
    ultimo_mensaje: iso(-18),
    no_leidos: 3,
    bot_activo: false,
    ventana_abierta: true,
    ventana_expira: iso(21 * 60 + 40),
    tipo_ventana: 'ctwa_72h',
    fuente: 'Meta Ads',
    pausado_por: 'César',
    pausado_en: iso(-4)
  },
  {
    phone_number_id: '1240006745865858',
    wa_id: '5214425550188',
    nombre: 'Laura M.',
    ultimo_texto: '¿Cuánto cuesta?',
    ultimo_mensaje: iso(-75),
    no_leidos: 0,
    bot_activo: true,
    ventana_abierta: true,
    ventana_expira: iso(22 * 60 + 45),
    tipo_ventana: 'servicio_24h',
    fuente: 'Meta Ads',
    pausado_por: null,
    pausado_en: null
  },
  {
    phone_number_id: '1240006745865858',
    wa_id: '5215512349876',
    nombre: 'Jorge V.',
    ultimo_texto: 'Gracias',
    ultimo_mensaje: iso(-2 * 24 * 60),
    no_leidos: 0,
    bot_activo: true,
    ventana_abierta: false,
    ventana_expira: iso(-24 * 60),
    tipo_ventana: 'cerrada',
    fuente: 'WhatsApp Directo',
    pausado_por: null,
    pausado_en: null
  }
];

export const demoMessages = new Map<string, Message[]>([
  [
    '1240006745865858:5214141047421',
    [
      {
        id: '1',
        message_id: 'wamid.demo.in.1',
        phone_number_id: '1240006745865858',
        wa_id: '5214141047421',
        direccion: 'in',
        autor: 'usuario',
        tipo: 'text',
        texto: 'Landing',
        media_id: null,
        estado: 'received',
        creado_en: iso(-2)
      },
      {
        id: '2',
        message_id: 'wamid.demo.out.1',
        phone_number_id: '1240006745865858',
        wa_id: '5214141047421',
        direccion: 'out',
        autor: 'bot',
        tipo: 'text',
        texto: '¡Hola! Vi que te interesa una página web. ¿Para qué tipo de negocio la necesitas?',
        media_id: null,
        estado: 'read',
        creado_en: iso(-1.7)
      }
    ]
  ],
  [
    '1240006745865858:5214271364410',
    [
      {
        id: '3',
        message_id: 'wamid.demo.in.2',
        phone_number_id: '1240006745865858',
        wa_id: '5214271364410',
        direccion: 'in',
        autor: 'usuario',
        tipo: 'text',
        texto: 'Me interesa un sitio web',
        media_id: null,
        estado: 'received',
        creado_en: iso(-18)
      },
      {
        id: '4',
        message_id: 'wamid.demo.out.2',
        phone_number_id: '1240006745865858',
        wa_id: '5214271364410',
        direccion: 'out',
        autor: 'bot',
        tipo: 'text',
        texto: 'Con gusto. ¿Qué tipo de negocio tienes?',
        media_id: null,
        estado: 'read',
        creado_en: iso(-16)
      },
      {
        id: '5',
        message_id: 'wamid.demo.in.3',
        phone_number_id: '1240006745865858',
        wa_id: '5214271364410',
        direccion: 'in',
        autor: 'usuario',
        tipo: 'text',
        texto: 'Una clínica dental',
        media_id: null,
        estado: 'received',
        creado_en: iso(-12)
      },
      {
        id: '6',
        message_id: 'wamid.demo.out.3',
        phone_number_id: '1240006745865858',
        wa_id: '5214271364410',
        direccion: 'out',
        autor: 'César',
        tipo: 'text',
        texto: 'Te paso la propuesta hoy mismo.',
        media_id: null,
        estado: 'delivered',
        creado_en: iso(-4)
      }
    ]
  ]
]);

export function demoKey(phoneNumberId: string, waId: string) {
  return `${phoneNumberId}:${waId}`;
}


export function getDemoConversations() {
  return conversations;
}

export function updateDemoConversation(
  phoneNumberId: string,
  waId: string,
  updater: (conversation: Conversation) => Conversation
) {
  const index = conversations.findIndex(
    (item) => item.phone_number_id === phoneNumberId && item.wa_id === waId
  );
  if (index >= 0) conversations[index] = updater(conversations[index]!);
}

export function deleteDemoConversation(phoneNumberId: string, waId: string) {
  const index = conversations.findIndex(
    (item) => item.phone_number_id === phoneNumberId && item.wa_id === waId
  );
  if (index < 0) return false;
  conversations.splice(index, 1);
  demoMessages.delete(demoKey(phoneNumberId, waId));
  return true;
}
