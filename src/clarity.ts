import Clarity from '@microsoft/clarity'

const projectId = String(import.meta.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ?? '').trim()

function isValidClarityProjectId(value: string): boolean {
  return /^[A-Za-z0-9]+$/.test(value)
}

/** Clarity already masks inputs; this attribute is an extra guarantee for form fields. */
function maskInputFields(): void {
  document.querySelectorAll('input, textarea, select').forEach((el) => {
    el.setAttribute('data-clarity-mask', 'true')
  })
}

if (isValidClarityProjectId(projectId)) {
  Clarity.init(projectId)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maskInputFields, { once: true })
  } else {
    maskInputFields()
  }
}
