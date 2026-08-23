import logging
from .base import BaseSessionAdapter

logger = logging.getLogger(__name__)


class MetaAIAdapter(BaseSessionAdapter):
    @property
    def scope(self) -> str:
        return 'metaai'

    def inject(self, data: dict, request_args: dict) -> dict:
        """Inject stored Meta AI session state into prompt kwargs."""
        kwargs = {}
        conv_id = data.get('metaai_conversation_id')
        if conv_id:
            kwargs['conversation_id'] = conv_id
            logger.debug('Injected metaai conversation_id: %s', str(conv_id))

        return kwargs

    def extract(self, response, data: dict) -> dict:
        """Extract and persist Meta AI conversation_id after a response."""
        new_data = dict(data)
        conv_id = None
        if isinstance(response, dict):
            conv_id = response.get('conversation_id')
        elif hasattr(response, 'conversation_id'):
            conv_id = getattr(response, 'conversation_id', None)

        if conv_id:
            new_data['metaai_conversation_id'] = conv_id
            logger.debug('Extracted metaai conversation_id: %s', str(conv_id))

        return new_data

    def clear_provider_session(self, data: dict) -> None:
        """Clear provider-side session IDs so the next request starts fresh."""
        data.pop('metaai_conversation_id', None)
        logger.debug('Cleared metaai provider session state')
