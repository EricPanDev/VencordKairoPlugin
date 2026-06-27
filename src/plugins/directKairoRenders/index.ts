/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

const TARGET_HOST = "renders.kairobot.me";

/**
 * If a media object points at the target host, replace its proxy URL with the
 * direct URL so Discord renders the image straight from the origin instead of
 * routing it through (and waiting on) its image proxy.
 *
 * Both snake_case (`proxy_url`) and camelCase (`proxyURL`) are set since the
 * raw dispatch payload uses snake_case while the processed record uses camelCase.
 */
const preloaded = new Set<string>();

function fixMedia(media: any) {
    if (!media?.url) return;
    let host: string;
    try {
        host = new URL(media.url).host;
    } catch {
        return;
    }
    if (host !== TARGET_HOST) return;

    // Swap the proxy URL to point directly at the origin (both cases — the raw
    // payload uses snake_case, the record uses camelCase).
    media.proxy_url = media.url;
    media.proxyURL = media.url;

    // Reserve the known render dimensions so Discord's container is sized
    // correctly from the start (no gray square).
    media.width = 900;
    media.height = 400;

    // Set the content type so Discord knows how to render the media.
    media.content_type = "image/webp";
    media.contentType = "image/webp";

    // Eagerly fetch into the browser cache so the image is ready by the time
    // Discord's component mounts. Use crossOrigin="anonymous" to match
    // Discord's <img> element, so the cache entry is actually shared.
    if (!preloaded.has(media.url)) {
        preloaded.add(media.url);
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.referrerPolicy = "no-referrer";
        img.src = media.url;
    }
}

function rewriteMessage(message: any) {
    if (!message) return;

    // Media gallery components (type 12) and similar component media
    for (const component of message.components ?? []) {
        if (component?.type === 12) {
            for (const item of component.items ?? []) {
                fixMedia(item?.media);
            }
        }
    }

    // Attachments
    for (const attachment of message.attachments ?? []) {
        fixMedia(attachment);
    }

    // Embeds
    for (const embed of message.embeds ?? []) {
        fixMedia(embed?.image);
        fixMedia(embed?.thumbnail);
        fixMedia(embed?.video);
    }
}

export default definePlugin({
    name: "DirectKairoRenders",
    description: "Loads Kairo (renders.kairobot.me) media directly from the source instead of waiting for Discord's image proxy.",
    tags: ["Media", "Chat"],
    authors: [Devs.Kairo],

    interceptor(dispatch: { type?: string; message?: any; messages?: any[]; }) {
        switch (dispatch.type) {
            case "MESSAGE_CREATE":
            case "MESSAGE_UPDATE":
                rewriteMessage(dispatch.message);
                break;
            case "LOAD_MESSAGES_SUCCESS":
            case "LOAD_RECENT_MESSAGES_SUCCESS":
            case "LOAD_PINNED_MESSAGES_SUCCESS":
            case "SEARCH_SUCCESS":
                for (const message of dispatch.messages ?? []) {
                    rewriteMessage(message);
                }
                break;
        }
    },

    start() {
        FluxDispatcher.addInterceptor(this.interceptor);
    },

    stop() {
        FluxDispatcher._interceptors = (FluxDispatcher._interceptors as any[]).filter(
            i => i !== this.interceptor
        );
    }
});
