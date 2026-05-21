import type { TextElement } from "./TextElement.js";
export type UserInput = {
    "type": "text";
    text: string;
    /**
     * UI-defined spans within `text` used to render or persist special elements.
     */
    text_elements: Array<TextElement>;
} | {
    "type": "image";
    url: string;
} | {
    "type": "localImage";
    path: string;
} | {
    "type": "skill";
    name: string;
    path: string;
} | {
    "type": "mention";
    name: string;
    path: string;
};
