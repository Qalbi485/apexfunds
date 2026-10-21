"use client";

import { useEffect, useRef } from "react";

/**
 * Official TradingView Advanced Chart widget (free embed). Gives the full,
 * real market with TradingView's own data, indicators and drawing tools.
 * The host is cleared and rebuilt whenever the symbol or interval changes.
 */

const SCRIPT_SRC =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

export function TradingViewChart({
  symbol,
  interval,
}: {
  symbol: string;
  interval: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.innerHTML = "";

    const container = document.createElement("div");
    container.className = "tradingview-widget-container";
    container.style.height = "100%";
    container.style.width = "100%";

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    container.appendChild(widget);
    host.appendChild(container);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = SCRIPT_SRC;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "rgba(28, 31, 45, 1)",
      gridColor: "rgba(50, 55, 74, 0.5)",
      allow_symbol_change: false,
      save_image: false,
      hide_top_toolbar: true,
      hide_side_toolbar: false,
      hide_legend: true,
      hide_volume: true,
      hideideasbutton: true,
      withdateranges: false,
      details: false,
      whitelabel: true,
      disabled_features: [
        "legend_context_menu",
        "scales_context_menu",
        "chart_crosshair_menu",
        "header_widget",
        "header_symbol_search",
        "header_compare",
        "header_saveload",
        "header_undo_redo",
        "header_settings",
        "header_fullscreen_button",
        "header_screenshot",
        "header_indicators",
        "header_chart_type",
        "header_resolutions",
        "control_bar",
        "timeframes_toolbar",
        "timezone_menu",
        "main_series_scale_menu",
        "show_object_tree",
        "items_favoriting",
        "legend_widget",
        "display_market_status",
        "symbol_info",
        "edit_buttons_in_legend",
        "delete_button_in_legend",
        "format_button_in_legend",
        "show_hide_button_in_legend",
        "object_tree_legend_mode",
        "create_volume_indicator_by_default",
        "create_volume_indicator_by_default_once",
        "use_localstorage_for_settings",
        "popup_hints",
        "border_around_the_chart",
        "adaptive_logo",
        "source_selection_markers",
        "save_shortcut",
      ],
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);

    return () => {
      host.innerHTML = "";
    };
  }, [symbol, interval]);

  return <div ref={hostRef} className="h-full w-full" />;
}
