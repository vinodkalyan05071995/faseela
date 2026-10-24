/* ============================================================
   MENU DATA
   ------------------------------------------------------------
   Each item supports an optional `image` (URL or local path).
   When `image` is empty, the app renders a designed gradient
   placeholder keyed off `tone`. Drop real photos in later by
   setting image: "img/halloumi.jpg" etc.
   ------------------------------------------------------------
   Dual-context: works as a browser <script> (window.BRAND /
   CATEGORIES / MENU) AND as a Node module (require("./data")),
   so the server resolves prices from the same source.
   ============================================================ */

(function (root) {
  "use strict";

  const BRAND = {
  name: "Faseela",
  wordmark: "Faseela",
  tagline: "Sandwiches, pastries & sweets.",
};

  const CATEGORIES = [
  { id: "sandwiches", label: "Sandwiches", note: "السندويشات" },
  { id: "pastries",   label: "Pastries",   note: "المعجنات والفطاير" },
  { id: "desserts",   label: "Desserts",   note: "الحلويات" },
];

/* tone → drives the placeholder gradient + accent.
   Prices are in Bahraini dinar, 3 decimals (800 fils = 0.800). */
  const MENU = [
  // ---- SANDWICHES ----
  { id: "sand-halloumi", cat: "sandwiches", tone: "wheat", badge: "Fan Fav",
    name: "Halloumi", price: 0.800, desc: "حلوم" },
  { id: "sand-liver", cat: "sandwiches", tone: "mocha",
    name: "Liver with Faseela Special Mix", price: 0.800, desc: "جبود بخلطة فسيلة" },
  { id: "sand-tuna", cat: "sandwiches", tone: "cold",
    name: "Tuna", price: 0.800, desc: "تونة" },
  { id: "sand-chicken-fajita", cat: "sandwiches", tone: "caramel",
    name: "Chicken Fajita", price: 0.800, desc: "فاهيتا الدجاج" },
  { id: "sand-shakshuka", cat: "sandwiches", tone: "berry",
    name: "Shakshuka", price: 0.700, desc: "شكشوكة" },
  { id: "sand-black-eyed-peas", cat: "sandwiches", tone: "coffee",
    name: "Black-Eyed Peas Sauté", price: 0.700, desc: "حمسة لوبة" },
  { id: "sand-potato-eggplant", cat: "sandwiches", tone: "wheat",
    name: "Potato & Eggplant Mix", price: 0.700, desc: "خلطة البطاطس بالباذنجان" },
  { id: "sand-falafel", cat: "sandwiches", tone: "green", badge: "Signature",
    name: "Falafel with Faseela Special Mix", price: 0.700, desc: "طعمية بخلطة فسيلة" },
  { id: "sand-boiled-egg-cheese", cat: "sandwiches", tone: "cream",
    name: "Boiled Egg with Cheese", price: 0.700, desc: "بيض مسلوق بالجبن" },
  { id: "sand-turkey-cheese", cat: "sandwiches", tone: "caramel",
    name: "Turkey & Cheese", price: 1.100, desc: "تيركي بالجبن" },

  // ---- PASTRIES ----
  { id: "pastry-pizza", cat: "pastries", tone: "berry",
    name: "Pizza", price: 0.800, desc: "بيتزا · 3 pieces" },
  { id: "pastry-cheese-zaatar", cat: "pastries", tone: "green",
    name: "Creamy Cheese & Za'atar Pastries", price: 0.700, desc: "فطاير الجبن بالزعتر الكريمي · 2 pieces" },
  { id: "pastry-chicken-mushroom", cat: "pastries", tone: "wheat",
    name: "Chicken, Mushroom & Cheese Pastries", price: 0.700, desc: "فطاير الدجاج بالمشروم والجبن · 2 pieces" },
  { id: "pastry-cheese-croissant", cat: "pastries", tone: "wheat",
    name: "Cheese Croissant", price: 0.700, desc: "كرسون الجبن · 2 pieces" },
  { id: "pastry-cheese-honey-puff", cat: "pastries", tone: "cream",
    name: "Creamy Cheese & Honey Puff", price: 0.700, desc: "باف بالجبن الكريمي والعسل · 2 pieces" },
  { id: "pastry-mahyawa-roll", cat: "pastries", tone: "caramel",
    name: "Mahyawa Bread Roll with Cheese", price: 0.700, desc: "رول خبز مهياوة بالجبن · 3 pieces" },
  { id: "pastry-grape-leaves", cat: "pastries", tone: "green", badge: "Fan Fav",
    name: "Sour & Tangy Grape Leaves", price: 1.250, desc: "ورق عنب حامض وناطع · half dozen (6 pieces)" },
  { id: "pastry-assorted", cat: "pastries", tone: "wheat",
    name: "Assorted Pastries", price: 1.100, desc: "معجنات مشكله · 3 pieces" },

  // ---- DESSERTS ----
  { id: "dess-date-treat-box", cat: "desserts", tone: "mocha", badge: "Signature",
    name: "Faseela Date Treat Box", price: 0.500, desc: "علبة تمرية فسيلة" },
  { id: "dess-creme-caramel", cat: "desserts", tone: "caramel",
    name: "Crème Caramel", price: 1.100, desc: "كريم كارميل" },
  { id: "dess-cheesecake", cat: "desserts", tone: "cream",
    name: "Cheesecake", price: 1.300, desc: "جيز كيك" },
  { id: "dess-umm-ali", cat: "desserts", tone: "wheat", badge: "Fan Fav",
    name: "Umm Ali", price: 1.500, desc: "ام علي" },
  { id: "dess-date-pudding", cat: "desserts", tone: "coffee",
    name: "Date Pudding", price: 1.500, desc: "بودنج التمر" },
  { id: "dess-mixed-nuts-box", cat: "desserts", tone: "coffee",
    name: "Mixed Nuts Box", price: 0.500, desc: "علبة مكسرات المشكلة" },
  { id: "dess-cookies", cat: "desserts", tone: "mocha",
    name: "Cookies", price: 0.800, desc: "كوكيز" },
  { id: "dess-carrot-cake", cat: "desserts", tone: "caramel",
    name: "Carrot Cake", price: 1.400, desc: "كيك الجزر" },
  { id: "dess-basbousa-cream", cat: "desserts", tone: "wheat",
    name: "Basbousa with Cream", price: 1.500, desc: "بسبوسة بالقشطة" },
  { id: "dess-chocolate-cake", cat: "desserts", tone: "espresso",
    name: "Faseela Chocolate Cake", price: 1.400, desc: "كيك جوكلت فسيلة" },
  { id: "dess-saffron-rusk", cat: "desserts", tone: "caramel",
    name: "Saffron Rusk", price: 0.250, desc: "شابورة بالزعفران" },
  { id: "dess-tiramisu", cat: "desserts", tone: "coffee", badge: "Fan Fav",
    name: "Tiramisu", price: 2.200, desc: "تراميسو" },
  { id: "dess-mango-trifle", cat: "desserts", tone: "caramel",
    name: "Mango Trifle", price: 1.500, desc: "ترايفل مانجو" },
];

  const api = { BRAND, CATEGORIES, MENU };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.BRAND = BRAND;
    root.CATEGORIES = CATEGORIES;
    root.MENU = MENU;
  }
})(typeof self !== "undefined" ? self : globalThis);
