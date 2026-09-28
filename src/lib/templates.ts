/**
 * Ready-made chains. Each builds nodes at relative positions; the studio drops them
 * next to whatever is already on the canvas. Models are referenced by id, so a
 * template stays valid as long as the model is in the registry.
 */
import type { GraphEdge, GraphNode } from "./graph/types";
import { defaultParams, getModel } from "./models/registry";
import type { DType, ParamValue } from "./models/types";

export interface Template {
  id: string;
  title: string;
  description: string;
  /** who it's for, shown as a tag */
  audience: string;
  build(): { nodes: GraphNode[]; edges: GraphEdge[] };
}

type P = { x: number; y: number };

const prompt = (id: string, position: P, text: string): GraphNode => ({ id, type: "prompt", position, data: { text } });
const file = (id: string, position: P, kind: "image" | "video" | "audio"): GraphNode =>
  ({ id, type: "image", position, data: { fileKey: null, name: "", kind } });
const note = (id: string, position: P, text: string): GraphNode => ({ id, type: "note", position, data: { text, color: "yellow" } });

function model(id: string, position: P, modelId: string, opts: { params?: Record<string, ParamValue> } = {}): GraphNode {
  const spec = getModel(modelId);
  if (!spec) throw new Error(`template model missing: ${modelId}`);
  return {
    id, type: "model", position,
    data: { kind: spec.kind, modelId, prompt: "", params: { ...defaultParams(spec), ...opts.params } },
  };
}

const wire = (source: string, dtype: DType, target: string, port: string): GraphEdge =>
  ({ id: `${source}-${target}-${port}`, source, sourceHandle: dtype, target, targetHandle: port });

export const TEMPLATES: Template[] = [
  {
    id: "product-card",
    title: "Карточка товара и видео",
    description: "Фото товара превращается в 4 варианта карточки для маркетплейса, лучший идёт в короткое видео.",
    audience: "Селлерам WB и Ozon",
    build: () => ({
      nodes: [
        file("photo", { x: 0, y: 0 }, "image"),
        prompt("brief", { x: 0, y: 300 }, "Карточка товара для маркетплейса: товар с фото на чистом светлом фоне, мягкие студийные тени, 3 главных преимущества короткими фразами на русском, современная аккуратная типографика"),
        model("card", { x: 420, y: 0 }, "openai/gpt-image-2", { params: { aspect_ratio: "3:4", n: "4" } }),
        prompt("motion", { x: 860, y: 260 }, "Медленный облёт камеры вокруг товара, студийный свет, лёгкие блики"),
        model("clip", { x: 1280, y: 0 }, "bytedance/seedance-2.0-fast", {
          params: { aspect_ratio: "3:4", generate_audio: false },
        }),
        note("tip", { x: 420, y: -170 }, "Загрузи фото товара, запусти видео: карточка сгенерируется сама. Кликни лучший вариант, он пойдёт в видео."),
      ],
      edges: [
        wire("photo", "image", "card", "references"),
        wire("brief", "text", "card", "prompt"),
        wire("card", "image", "clip", "first_frame"),
        wire("motion", "text", "clip", "prompt"),
      ],
    }),
  },
  {
    id: "idea-to-video",
    title: "Идея, кадр, видео",
    description: "Короткая идея своими словами. Модель расписывает её в подробный промт, рисует кадр и оживляет его.",
    audience: "Креаторам",
    build: () => ({
      nodes: [
        prompt("idea", { x: 0, y: 0 }, "Уютная кофейня в дождливый вечер, за окном огни города"),
        model("writer", { x: 400, y: 0 }, "deepseek/deepseek-v4.1-flash", {
          params: { system: "Преврати идею в подробный промт для кинематографичного кадра: объект, окружение, свет, объектив, стиль. Ответь только промтом." },
        }),
        model("frame", { x: 820, y: 0 }, "openai/gpt-image-2"),
        prompt("motion", { x: 1240, y: 260 }, "Камера плавно движется вперёд, пар поднимается над чашкой, капли стекают по стеклу"),
        model("clip", { x: 1660, y: 0 }, "bytedance/seedance-2.0-fast"),
      ],
      edges: [
        wire("idea", "text", "writer", "prompt"),
        wire("writer", "text", "frame", "prompt"),
        wire("frame", "image", "clip", "first_frame"),
        wire("motion", "text", "clip", "prompt"),
      ],
    }),
  },
  {
    id: "character-refs",
    title: "Персонаж по референсам",
    description: "Два-три изображения персонажа, и Seedance снимает с ним новую сцену, сохраняя внешность. Подходит для иллюстраций и 3D-героев.",
    audience: "Клипмейкерам",
    build: () => ({
      nodes: [
        file("face1", { x: 0, y: 0 }, "image"),
        file("face2", { x: 0, y: 260 }, "image"),
        prompt("scene", { x: 0, y: 520 }, "Персонаж с референсов идёт по ночному рынку, камера следует сзади, неоновый свет, лёгкий дождь"),
        model("clip", { x: 420, y: 120 }, "bytedance/seedance-2.0"),
        note("tip", { x: 420, y: -150 }, "Seedance не принимает фото реальных людей (фильтр приватности). Бери иллюстрации, 3D-персонажей или стилизованные кадры."),
      ],
      edges: [
        wire("face1", "image", "clip", "references"),
        wire("face2", "image", "clip", "references"),
        wire("scene", "text", "clip", "prompt"),
      ],
    }),
  },
  {
    id: "long-video",
    title: "Длинный ролик из двух сцен",
    description: "Последний кадр первой сцены становится первым кадром второй, потом обе склеиваются в один ролик.",
    audience: "Для роликов длиннее 15 секунд",
    build: () => ({
      nodes: [
        prompt("s1", { x: 0, y: 0 }, "Девушка в красном пальто выходит из метро на заснеженную улицу, вечер, фонари"),
        model("a", { x: 400, y: 0 }, "bytedance/seedance-2.0-fast"),
        model("frame", { x: 840, y: 0 }, "kaskad/last-frame"),
        prompt("s2", { x: 840, y: 470 }, "Она поворачивается к камере и улыбается, снег идёт сильнее, камера медленно приближается"),
        model("b", { x: 1260, y: 0 }, "bytedance/seedance-2.0-fast"),
        model("join", { x: 1700, y: 0 }, "kaskad/concat"),
      ],
      edges: [
        wire("s1", "text", "a", "prompt"),
        wire("a", "video", "frame", "video"),
        wire("frame", "image", "b", "first_frame"),
        wire("s2", "text", "b", "prompt"),
        wire("a", "video", "join", "clips"),
        wire("b", "video", "join", "clips"),
      ],
    }),
  },
  {
    id: "restyle",
    title: "Разобрать картинку и перерисовать",
    description: "Модель описывает твою картинку словами, а Recraft рисует по этому описанию в новом стиле.",
    audience: "Дизайнерам",
    build: () => ({
      nodes: [
        file("src", { x: 0, y: 0 }, "image"),
        prompt("ask", { x: 0, y: 300 }, "Опиши картинку как промт для генерации: объекты, композиция, свет, цвета. Добавь в конце: в стиле плоской векторной иллюстрации."),
        model("describe", { x: 400, y: 0 }, "deepseek/deepseek-v4.1-flash"),
        model("draw", { x: 820, y: 0 }, "recraft/recraft-v4.1"),
      ],
      edges: [
        wire("src", "image", "describe", "images"),
        wire("ask", "text", "describe", "prompt"),
        wire("describe", "text", "draw", "prompt"),
      ],
    }),
  },
  {
    id: "upscale",
    title: "Апскейл своего видео",
    description: "Загрузи ролик, и FLUX увеличит его разрешение в 1,5 до 3 раз без изменения длины.",
    audience: "Для финальной сборки",
    build: () => ({
      nodes: [
        file("src", { x: 0, y: 0 }, "video"),
        model("up", { x: 420, y: 0 }, "black-forest-labs/flux-video-upscale"),
      ],
      edges: [wire("src", "video", "up", "source")],
    }),
  },
];

/** Node types of a template in chain order, for the card preview. */
export function templateChain(t: Template): GraphNode[] {
  return t.build().nodes.filter((n) => n.type !== "note");
}
