import type { Dict } from "../core";
import common from "./common";
import dashboard from "./dashboard";
import errors from "./errors";
import money from "./money";
import orders from "./orders";
import products from "./products";
import profit from "./profit";
import settings from "./settings";

/**
 * Every Arabic text, one file per part of the app. A text used in several parts can sit in any of
 * them: they all say the same thing.
 */
export const AR: Dict = { ...errors, ...common, ...dashboard, ...profit, ...orders, ...products, ...money, ...settings };
