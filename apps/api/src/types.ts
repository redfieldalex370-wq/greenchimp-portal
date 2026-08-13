export type PortalUser = {
  id: string;
  username: string;
  name: string;
  email: string | null;
};

export type Conversation = {
  phone_number_id: string;
  wa_id: string;
  usuario_id?: string | null;
  nombre: string;
  ultimo_texto: string;
  ultimo_mensaje: string;
  no_leidos: number;
  bot_activo: boolean;
  ventana_abierta: boolean;
  ventana_expira: string | null;
  tipo_ventana: string;
  fuente: string;
  pausado_por: string | null;
  pausado_en: string | null;
};

export type Message = {
  id: string;
  message_id: string;
  phone_number_id: string;
  wa_id: string;
  usuario_id?: string | null;
  direccion: 'in' | 'out';
  autor: string;
  tipo: string;
  texto: string;
  media_id: string | null;
  estado: string;
  creado_en: string;
};
