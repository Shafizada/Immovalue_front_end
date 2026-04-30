const API_BASE_URL = ""; 
// For Cloudflare Worker later, use for example:
// const API_BASE_URL = "https://immovalue-api.sshafizada-shafi.workers.dev";

const form = document.querySelector("#prediction-form");
const predictionEl = document.querySelector("#prediction");
const pricePerM2El = document.querySelector("#price-per-m2");
const statusEl = document.querySelector("#status");

const checkboxFields = new Set([
  "terrace_yes_no",
  "garden_yes_no",
  "garage_yes_no",
  "parking_yes_no",
  "lift_yes_no",
  "double_glazing_yes_no",
  "energy_renovation_required_yes_no",
  "electricity_conform_yes_no",
  "flood_area_yes_no",
  "newbuild_yes_no",
]);

const fallbackOptions = {
  defaults: {
    city: "Antwerpen",
    postcode: "2018",
    property_type: "Apartment",
    property_subtype: "Apartment",
    surface_area_m2: 100,
    bedrooms: 2,
    bathrooms: 1,
    floor: 2,
    year_built: 1990,
    facades: 2,
    condition_score: 3,
    monthly_cost: 150,
    cadastral_income: 900,
    epc_label: "C",
    epc_score_kwh_m2_year: 180,
    double_glazing_yes_no: 1,
    electricity_conform_yes_no: 1,
  },
  cities: ["Antwerpen", "Berchem", "Borgerhout", "Deurne", "Merksem", "Wilrijk"],
  postcodes: ["2000", "2018", "2020", "2060", "2100", "2140", "2170", "2600", "2610"],
  property_types: ["Apartment", "House"],
  property_subtypes: ["Apartment", "Duplex", "Penthouse", "Studio", "Ground floor"],
  epc_labels: ["A+", "A", "B", "C", "D", "E", "F"],
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function setDatalist(id, values) {
  const list = document.querySelector(id);
  if (!list) return;

  list.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    list.appendChild(option);
  });
}

function setSelect(id, values) {
  const select = document.querySelector(id);
  if (!select) return;

  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select EPC label";
  select.appendChild(placeholder);

  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function applyDefaults(defaults) {
  Object.entries(defaults).forEach(([name, value]) => {
    const field = form.elements[name];
    if (!field) return;

    if (checkboxFields.has(name)) {
      field.checked = Number(value) === 1;
    } else {
      field.value = value;
    }
  });
}

function collectPayload() {
  const payload = {};
  const data = new FormData(form);

  for (const [key, value] of data.entries()) {
    payload[key] = value;
  }

  checkboxFields.forEach((key) => {
    if (form.elements[key]) {
      payload[key] = form.elements[key].checked ? 1 : 0;
    }
  });

  return payload;
}

function localPredict(payload) {
  const surface = Number(payload.surface_area_m2 || 0);
  const bedrooms = Number(payload.bedrooms || 0);
  const bathrooms = Number(payload.bathrooms || 0);
  const yearBuilt = Number(payload.year_built || 1970);
  const epcScore = Number(payload.epc_score_kwh_m2_year || 200);

  let pricePerM2 = 3300;

  if (payload.postcode === "2000") pricePerM2 += 700;
  if (payload.postcode === "2018") pricePerM2 += 450;

  if (payload.epc_label === "A+" || payload.epc_label === "A") pricePerM2 += 350;
  if (payload.epc_label === "B") pricePerM2 += 200;
  if (payload.epc_label === "E" || payload.epc_label === "F") pricePerM2 -= 350;

  if (Number(payload.terrace_yes_no) === 1) pricePerM2 += 150;
  if (Number(payload.garage_yes_no) === 1) pricePerM2 += 200;
  if (Number(payload.parking_yes_no) === 1) pricePerM2 += 100;
  if (Number(payload.lift_yes_no) === 1) pricePerM2 += 120;

  if (yearBuilt > 2015) pricePerM2 += 250;
  if (epcScore > 300) pricePerM2 -= 250;

  const predictedPrice = surface * pricePerM2 + bedrooms * 7500 + bathrooms * 5000;

  return {
    predicted_price: predictedPrice,
    estimated_price_per_m2: pricePerM2,
  };
}

async function predict() {
  statusEl.textContent = "Updating";
  const payload = collectPayload();

  try {
    const response = await fetch(`${API_BASE_URL}/api/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error("Backend not available");

    const result = await response.json();

    predictionEl.textContent = currencyFormatter.format(result.predicted_price);
    pricePerM2El.textContent = `${currencyFormatter.format(result.estimated_price_per_m2)} per m2 basis`;
    statusEl.textContent = "Ready";
  } catch (error) {
    const result = localPredict(payload);

    predictionEl.textContent = currencyFormatter.format(result.predicted_price);
    pricePerM2El.textContent = `${currencyFormatter.format(result.estimated_price_per_m2)} per m2 basis`;
    statusEl.textContent = "Ready - local estimate";
  }
}

function debounce(fn, delay) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, delay);
  };
}

async function init() {
  let options = fallbackOptions;

  try {
    const response = await fetch(`${API_BASE_URL}/api/options`);
    if (response.ok) {
      const apiOptions = await response.json();
      options = {
        ...fallbackOptions,
        ...apiOptions,
        defaults: {
          ...fallbackOptions.defaults,
          ...(apiOptions.defaults || {}),
        },
      };
    }
  } catch (error) {
    statusEl.textContent = "Static form ready";
  }

  setDatalist("#city-options", options.cities || fallbackOptions.cities);
  setDatalist("#postcode-options", options.postcodes || fallbackOptions.postcodes);
  setDatalist("#property-type-options", options.property_types || fallbackOptions.property_types);
  setDatalist("#property-subtype-options", options.property_subtypes || fallbackOptions.property_subtypes);
  setSelect("#epc_label", options.epc_labels || fallbackOptions.epc_labels);

  applyDefaults(options.defaults || fallbackOptions.defaults);

  const debouncedPredict = debounce(predict, 250);
  form.addEventListener("input", debouncedPredict);
  form.addEventListener("change", debouncedPredict);

  predict();
}

init();