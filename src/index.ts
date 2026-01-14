import { ComponentSettings, Manager, MCEvent } from '@managed-components/types'
import UAParser from 'ua-parser-js'

export const eventHandler = async (
  eventType: string,
  manager: Manager,
  event: MCEvent,
  settings: ComponentSettings
) => {
  const { payload, client } = event

  const { writeKey, hostname = 'api.segment.io' } = settings
  const endpoint = `https://${hostname}/v1/${eventType}`

  // Prepare new payload
  const uaParser = new UAParser(client.userAgent).getResult()

  // Extract trait- prefixed properties and filter out reserved fields
  const reservedFields = ['userId', 'anonymousId', 'callType', 'event']
  const traitProperties: Record<string, unknown> = {}
  const filteredPayload: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(payload)) {
    if (value === null) continue
    if (key.startsWith('trait-')) {
      traitProperties[key.slice('trait-'.length)] = value
    } else if (!reservedFields.includes(key)) {
      filteredPayload[key] = value
    }
  }

  /* eslint-disable  @typescript-eslint/no-explicit-any */
  const segmentPayload: any = {
    ...(eventType !== 'page' && payload.event && { event: payload.event }),
    ...(eventType !== 'page' && { anonymousId: payload.anonymousId }),
    ...(eventType !== 'page' && { userId: payload.userId }),
    context: {
      ip: client.ip,
      locale: client.language,
      page: {
        url: client.url.href,
        title: client.title,
        referrer: client.referer,
        path: client.url.pathname,
        search: client.url.search,
      },
      screen: {
        width: client.screenWidth,
        height: client.screenHeight,
      },
      os: { name: uaParser.os.name },
      userAgent: uaParser.ua,
      ...(eventType !== 'identify' &&
        Object.keys(traitProperties).length > 0 && {
          traits: traitProperties,
        }),
    },
  }

  if (eventType === 'identify' || eventType === 'group') {
    segmentPayload.traits = { ...filteredPayload, ...traitProperties }
  } else {
    segmentPayload.properties = filteredPayload
  }

  if (eventType === 'page') {
    segmentPayload.properties = {
      ...segmentPayload.properties,
      ...segmentPayload.context.page,
    }
  }

  // If we don't have anonymousId, try to get it from the cookie
  if (!segmentPayload.anonymousId && client.get('ajs_anonymous_id')) {
    segmentPayload.anonymousId = client.get('ajs_anonymous_id')
  }

  // If both userid and anonymousId are missing, generate one
  if (!segmentPayload.userId && !segmentPayload.anonymousId) {
    const anonId = crypto.randomUUID()
    segmentPayload.anonymousId = anonId
    client.set('ajs_anonymous_id', anonId, {
      scope: 'infinite',
    })
  }

  // Send the request
  const headers = {
    Authorization: 'Basic ' + btoa(writeKey),
    'Content-Type': 'application/json',
  }

  manager.fetch(endpoint, {
    headers,
    method: 'POST',
    body: JSON.stringify(segmentPayload),
  })
}

export default async function (manager: Manager, settings: ComponentSettings) {
  manager.addEventListener('pageview', event => {
    eventHandler('page', manager, event, settings)
  })
  manager.addEventListener('track', event => {
    eventHandler('track', manager, event, settings)
  })
  manager.addEventListener('identify', event => {
    eventHandler('identify', manager, event, settings)
  })
  manager.addEventListener('alias', event => {
    eventHandler('alias', manager, event, settings)
  })
  manager.addEventListener('group', event => {
    eventHandler('group', manager, event, settings)
  })
}
