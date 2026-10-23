const array = (value) => Array.isArray(value) ? value : [];
const nonempty = (value) => value !== null && value !== undefined && value !== '';

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function plain(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return nonempty(value) ? String(value) : null;
}

function html(value) {
  return escapeHtml(plain(value) ?? '—');
}

function name(value) {
  if (!value || typeof value !== 'object') return null;
  const family = [value.family, value.suffix].filter(nonempty).join(' ');
  const given = [value.prefix, value.given, value.middle, value.degree].filter(nonempty).join(' ');
  return [family, given].filter(Boolean).join(', ') || null;
}

function code(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.display && value.code && value.display !== value.code) return `${value.display} (${value.code})`;
  return value.display || value.code || null;
}

function dateOnly(value) {
  const raw = typeof value === 'object' && value !== null ? value.local_value : value;
  const match = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month && check.getUTCDate() === day
    ? { year, month, day, text: match[0] } : null;
}

function ageAt(birthDate, collectionTime) {
  const birth = dateOnly(birthDate);
  const collection = dateOnly(collectionTime);
  if (!birth || !collection) return null;
  const age = collection.year - birth.year
    - (collection.month < birth.month || (collection.month === birth.month && collection.day < birth.day) ? 1 : 0);
  return age >= 0 && age <= 130 ? String(age) : null;
}

function labTime(value) {
  if (!value) return null;
  const local = value.local_value || value.source_value;
  if (!local) return null;
  const text = String(local).replace('T', ' ');
  return value.utc_offset ? `${text} (UTC${value.utc_offset})` : text;
}

function fields(items, className = 'fields') {
  const rows = items.filter(([, value]) => nonempty(value));
  if (!rows.length) return '';
  return `<dl class="${className}">${rows.map(([label, value]) =>
    `<div><dt>${escapeHtml(label)}</dt><dd>${html(value)}</dd></div>`).join('')}</dl>`;
}

function notes(label, values) {
  const lines = array(values).filter(nonempty);
  if (!lines.length) return '';
  return `<details class="notes"><summary>${escapeHtml(label)}<span>${lines.length} ${lines.length === 1 ? 'line' : 'lines'}</span></summary>
    <pre>${escapeHtml(lines.join('\n'))}</pre></details>`;
}

function address(value) {
  if (!value) return null;
  return [...array(value.lines), [value.city, value.state, value.postal_code].filter(nonempty).join(', '), value.country]
    .filter(nonempty).join(' · ') || null;
}

function clinicalInformation(value, shared = null) {
  if (!value) return '';
  const detail = fields([
    ['Clinical Info', value.information === shared?.information ? null : value.information],
    ['Fasting', value.fasting === shared?.fasting ? null : value.fasting],
    ['Total Volume', value.total_volume === shared?.total_volume ? null : value.total_volume],
  ], 'inline-fields');
  const distinctNotes = JSON.stringify(array(value.notes)) === JSON.stringify(array(shared?.notes))
    ? [] : value.notes;
  return detail + notes('Clinical Information Notes', distinctNotes);
}

function specimenDetails(details) {
  if (!array(details).length) return '';
  return `<div class="specimen-details"><h4>Specimen Details</h4>${details.map((detail, index) =>
    `<div class="detail-block"><h5>Detail ${index + 1}</h5>${fields([
      ['Specimen ID', detail.specimen_id], ['Source', detail.source],
      ['Source Modifiers', detail.source_modifiers], ['Body Site', detail.body_site],
      ['Body Site Modifiers', detail.body_site_modifiers], ['Description', detail.description],
      ['Collection Time', labTime(detail.collection_time)],
      ['Collection End Time', labTime(detail.collection_end_time)],
    ], 'inline-fields')}${notes('Specimen Detail Notes', detail.notes)}</div>`).join('')}</div>`;
}

function testDetails(test, specimenClinicalInformation) {
  const summary = fields([
    ['Test Code', test.code],
    ['Collection Time', labTime(test.collection_time)], ['Received Time', labTime(test.received_time)],
    ['Lab Release Time', labTime(test.lab_release_time)], ['Source', test.source],
    ['Organism', test.organism],
  ], 'test-fields');
  const additional = fields([
    ['Control Number', test.control_number], ['Alternate Control Number', test.alternate_control_number],
    ['Ordering Provider', name(test.ordering_provider?.name)],
    ['Provider NPI', test.ordering_provider?.npi], ['Action Code', test.action_code],
    ['Parent Result Code', test.parent_result_code],
    ['Parent Result Sub-ID', test.parent_result_sub_id], ['Parent Order Code', test.parent_order_code],
  ], 'test-fields');
  return summary + clinicalInformation(test.clinical_information, specimenClinicalInformation)
    + (additional ? `<details class="panel-details"><summary>Additional Panel Details</summary>${additional}</details>` : '')
    + specimenDetails(test.specimen_details) + notes('Test Notes', test.notes);
}

function flags(observation) {
  return array(observation.abnormal_flags).map(code).filter(nonempty).map((value) =>
    `<span class="flag">${escapeHtml(value)}</span>`).join(' ');
}

function relationships(observation, observationNames) {
  return array(observation.relationships).map((relation) => {
    const target = observationNames.get(relation.target_observation_id);
    return `${relation.type || 'Related'}: ${target || relation.target_observation_id}`;
  });
}

function observationRows(observation, observationNames, label) {
  const details = [
    ['Result Time', labTime(observation.result_time)],
    ['Interpretation', observation.interpretation],
    ['Result Code', observation.code],
    ['Sub-ID', observation.sub_id],
    ['Value Type', observation.value_type],
    ['Related Results', relationships(observation, observationNames).join('; ')],
  ];
  const detailsHtml = fields(details, 'inline-fields');
  const notesHtml = notes('Result Notes', observation.notes);
  const isCritical = observation.interpretation === 'critical';
  const className = isCritical ? ' critical'
    : observation.interpretation === 'abnormal' ? ' abnormal' : '';
  const result = `<tr class="result-row${className}">
    <th scope="row">${html(label || observation.name || observation.code)}</th>
    <td class="result-text">${html(observation.result)}</td>
    <td>${isCritical ? '<strong class="critical-label">Critical</strong>' : ''}${flags(observation) || (isCritical ? '' : '—')}</td>
    <td>${html(observation.units)}</td>
    <td class="result-text">${html(observation.reference_interval)}</td>
    <td>${html(code(observation.status))}</td>
    <td>${html(observation.performing_lab)}</td>
  </tr>`;
  return result + (detailsHtml || notesHtml
    ? `<tr class="result-detail"><td colspan="7"><details class="observation-details">
        <summary>${notesHtml ? 'Result Details and Comments' : 'Result Details'}</summary>
        <div>${detailsHtml}${notesHtml}</div>
      </details></td></tr>` : '');
}

function testCard(test, observationNames, specimenClinicalInformation) {
  const observations = array(test.observations);
  const criticalCount = observations.filter((observation) => observation.interpretation === 'critical').length;
  const sameSingleName = observations.length === 1 && test.name && observations[0].name
    && test.name.trim().toLocaleLowerCase() === observations[0].name.trim().toLocaleLowerCase();
  const rows = observations.length
    ? observations.map((observation) => observationRows(
      observation, observationNames, sameSingleName ? 'Result' : null,
    )).join('')
    : '<tr class="no-results"><td colspan="7">No observation rows were reported for this test. Review its status and notes above.</td></tr>';
  return `<section class="test-card">
    <div class="test-card-heading"><h4>${html(test.name || test.code || 'Unnamed Test')}</h4>
      <div class="test-status-group">${criticalCount
        ? `<strong class="critical-summary">${criticalCount} Critical ${criticalCount === 1 ? 'Result' : 'Results'}</strong>` : ''}
        <span class="test-status">${html(code(test.status))}</span></div></div>
    <div class="test-card-details">${testDetails(test, specimenClinicalInformation)}</div>
    <div class="table-scroll" tabindex="0" aria-label="Results table">
      <table class="results-table">
        <thead><tr><th scope="col">Test</th><th scope="col">Result</th><th scope="col">Flag</th>
          <th scope="col">Units</th><th scope="col">Reference Interval</th><th scope="col">Status</th><th scope="col">Lab</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
  </section>`;
}

function resultsTable(specimen) {
  const tests = array(specimen.ordered_tests);
  const observationNames = new Map(tests.flatMap((test) => array(test.observations).map((observation) =>
    [observation.id, observation.name || observation.code || observation.id])));
  return tests.length ? tests.map((test) => testCard(test, observationNames, specimen.clinical_information)).join('')
    : '<p>No ordered tests were reported for this specimen.</p>';
}

function patientHeader(specimen, report, order) {
  const specimenPatient = specimen.patient || {};
  const patient = name(specimenPatient.name) || specimenPatient.lab_patient_id || specimenPatient.birth_date
    ? specimenPatient : report.patient || specimenPatient;
  const orderPatient = order.patient_details || {};
  const labName = name(patient.name);
  const birthDate = patient.birth_date;
  const ageBirthDate = birthDate || orderPatient.dob;
  const provider = report.ordering_provider;
  return `<div class="report-header">
    ${fields([
      ['Patient Name', labName],
      ['DOB', dateOnly(birthDate)?.text || null],
      ['Sex', patient.sex],
      [birthDate ? 'Age at Collection' : 'Age at Collection (from Order DOB)', ageAt(ageBirthDate, specimen.collection_time)],
      ['Labcorp Patient ID', patient.lab_patient_id],
      ['Alternate Patient IDs', array(patient.alternate_patient_ids).join(', ')],
      ['Patient Address', address(patient.address)],
      ['Control Number', specimen.control_number],
      ['Alternate Control Number', specimen.alternate_control_number],
      ['Account Number', specimen.lab_account_number || report.lab_account_number],
      ['Specimen ID', specimen.specimen_id],
      ['Ordering Provider', name(provider?.name)], ['Provider NPI', provider?.npi],
      ['Collection Date and Time', labTime(specimen.collection_time)],
      ['Reported Date and Time', labTime(specimen.lab_release_time)],
      ['Result Status', code(specimen.report_status) || code(report.report_status)],
    ])}
  </div>`;
}

function renderSpecimen(specimen, report, order, index) {
  const reportPatientNotes = index === 0 ? array(report.patient?.notes) : [];
  const specimenPatientNotes = array(specimen.patient?.notes);
  const repeatedPatientNotes = reportPatientNotes.length && specimenPatientNotes.length
    && JSON.stringify(reportPatientNotes) === JSON.stringify(specimenPatientNotes);
  return `<section class="specimen" aria-labelledby="specimen-${index}">
    <h2 id="specimen-${index}">Specimen ${index + 1}${specimen.specimen_id ? ` · ${escapeHtml(specimen.specimen_id)}` : ''}</h2>
    ${patientHeader(specimen, report, order)}
    ${index === 0 ? notes('General Comments and Additional Information', report.notes) : ''}
    ${index === 0 ? notes('Report Patient Comments', report.patient?.notes) : ''}
    ${repeatedPatientNotes ? '' : notes('Patient Comments', specimen.patient?.notes)}
    ${notes('Specimen Comments', specimen.notes)}
    <section class="clinical-info"><h3>Clinical Information</h3>
      ${fields([['Source', specimen.source], ['Body Site', specimen.body_site],
        ['Labcorp Message ID', specimen.message_id], ['Message Time', labTime(specimen.message_time)]], 'inline-fields')}
      ${clinicalInformation(specimen.clinical_information)}
    </section>
    <section class="results"><h3>Results</h3>${resultsTable(specimen)}</section>
  </section>`;
}

function labDirectory(laboratories) {
  const entries = Object.entries(laboratories || {});
  if (!entries.length) return '';
  return `<section class="lab-directory"><h2>Performing Laboratories</h2>
    <div class="table-scroll"><table><thead><tr><th>Lab</th><th>Lab Name and Address</th><th>Phone</th><th>Medical Director</th><th>CLIA</th></tr></thead>
    <tbody>${entries.map(([key, lab]) => `<tr><td>${html(key)}</td><td>${html([lab.name, address(lab.address)].filter(Boolean).join(' · '))}</td>
      <td>${html(lab.phone)}</td><td>${html(name(lab.medical_director))}</td><td>${html(lab.clia)}</td></tr>`).join('')}</tbody></table></div>
  </section>`;
}

export function renderReport(order, clinical) {
  if (!clinical?.report || !Array.isArray(clinical.report.specimens)) {
    return renderUnavailable('Junction returned an incomplete clinical report.');
  }
  const report = clinical.report;
  const orderPatient = order.patient_details || {};
  const orderName = [orderPatient.first_name, orderPatient.last_name].filter(nonempty).join(' ');
  return `<article class="report">
    <div class="report-title"><div><p class="eyebrow">Labcorp results via Junction</p><h1>Clinical Result Report</h1></div>
      <div class="report-status"><span>Overall Status</span><strong>${html(code(report.report_status))}</strong></div></div>
    ${report.specimens.length ? '' : '<p class="empty-report">No specimens were returned in this clinical report.</p>'}
    ${array(report.specimens).map((specimen, index) => renderSpecimen(specimen, report, order, index)).join('')}
    ${labDirectory(report.performing_laboratories)}
    <section class="report-context"><h2>Junction Order Context</h2>${fields([
      ['Junction Order ID', clinical.order_id],
      ['Junction User ID', clinical.user_id || order.user_id],
      ['Order Patient', orderName], ['Order DOB', dateOnly(orderPatient.dob)?.text || null],
      ['Order Gender', orderPatient.gender], ['Source Lab', report.source_lab],
    ], 'inline-fields')}</section>
    <p class="footnote">This example view presents the current clinical report returned by Junction. Check the report again when results change.</p>
  </article>`;
}

export function renderUnavailable(message) {
  return `<section class="notice" role="status"><h2>Report unavailable</h2><p>${html(message)}</p></section>`;
}

export function renderPage(content, { demo = false, exampleOrderId = '', orderId = '' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Labcorp Result View Example</title><link rel="stylesheet" href="/styles.css"></head>
    <body><main class="page"><header class="app-header"><div><p class="eyebrow">Junction API example</p>
      <h1>Labcorp Results</h1><p>Enter an order ID to view its current clinical report.</p></div>
      ${demo ? '<span class="demo-label">Synthetic demo data</span>' : ''}</header>
      <form class="order-form" action="/report" method="post"><label for="order_id">Junction Order ID</label>
        <div class="form-row"><input id="order_id" name="order_id" type="text" required
          pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
          value="${escapeHtml(orderId || (demo ? exampleOrderId : ''))}" autocomplete="off"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"><button type="submit">View Results</button></div>
      </form>${content || '<p class="start-hint">The report will appear here after you submit an order ID.</p>'}
    </main></body></html>`;
}
