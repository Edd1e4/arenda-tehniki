// Pure intake checks. No model, network, storage, booking or SMS side effects.
export function reviewIntake(input = {}, { today } = {}) {
  const missing = [];
  const questions = {
    cargo: 'Что нужно перевезти?',
    pickup: 'Откуда забрать груз?',
    dropoff: 'Куда доставить груз?',
    date: 'На какую дату нужна машина?',
    time: 'К какому времени нужна подача по Москве?',
    dimensions: 'Какие размеры самого крупного места и сколько мест?',
    contact: 'Как с вами связаться?'
  };
  const clean = Object.fromEntries(Object.keys(questions).map(k => [k, typeof input[k] === 'string' ? input[k].trim() : '']));
  for (const key of Object.keys(questions)) if (!clean[key]) missing.push(key);
  const reasons = [];
  let suggestedVehicle = null;
  const value = input.weightKg;
  const weight = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : NaN;
  if (!Number.isFinite(weight) || weight <= 0) {
    missing.push('weightKg');
    questions.weightKg = 'Какой общий вес груза? Если неизвестен, уточним с человеком.';
  } else if (weight > 2000) {
    reasons.push('over_capacity');
  } else {
    suggestedVehicle = weight <= 500 ? 'Volkswagen Caddy' : 'Ford Transit';
  }
  if (input.requestedVehicle === 'Volkswagen Caddy' && weight > 500) reasons.push('caddy_over_capacity');
  if (input.requestedVehicle === 'Ford Transit' && weight > 2000 && !reasons.includes('over_capacity')) reasons.push('over_capacity');
  if (input.requestedVehicle && !['Volkswagen Caddy', 'Ford Transit'].includes(input.requestedVehicle)) reasons.push('special_equipment');
  if (!['inside_mkad_outside_garden', 'region_within_50km'].includes(input.zone)) reasons.push('route_needs_review');
  if (input.needsHuman === true) reasons.push('customer_requests_human');
  if (clean.date) {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(clean.date) && !Number.isNaN(Date.parse(clean.date+'T00:00:00Z')) && new Date(clean.date+'T00:00:00Z').toISOString().slice(0,10) === clean.date;
    if (!valid || (today && clean.date < today)) {
      if (!missing.includes('date')) missing.push('date');
      questions.date = 'Уточните корректную дату подачи, не раньше сегодняшнего дня.';
    }
  }
  if (clean.time) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clean.time)) {
      missing.push('time'); questions.time = 'Уточните время в формате часы:минуты.';
    } else if (clean.time < '08:00' || clean.time >= '18:00') reasons.push('outside_work_hours');
  }
  // A weight match is provisional: vehicle geometry and availability are not known.
  const status = reasons.length ? 'human_review' : missing.length ? 'needs_details' : 'ready_for_quote';
  return {
    status, missing, reasons, suggestedVehicle,
    nextQuestion: missing.length ? questions[missing[0]] : null,
    requiresHumanConfirmation: true,
    price: null, bookingConfirmed: false, smsSent: false,
    checksPending: ['cargo_dimensions_fit', 'route_and_access', 'availability', 'final_price'],
    summary: { ...clean, weightKg: Number.isFinite(weight) && weight > 0 ? weight : null }
  };
}
