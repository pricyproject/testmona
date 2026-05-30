import random
import string
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from faker import Faker
import json

class BaseDataProvider:
    """Base class for all test data providers"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.fake = Faker()
        
    def generate(self, count: int = 1) -> List[str]:
        """Generate specified number of data items"""
        raise NotImplementedError
    
    def generate_single(self) -> str:
        """Generate a single data item"""
        raise NotImplementedError

class NameProvider(BaseDataProvider):
    """Generate realistic names"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.locale = self.config.get('locale', 'en_US')
        self.fake = Faker(self.locale)
        self.name_type = self.config.get('name_type', 'full')  # full, first, last
    
    def generate_single(self) -> str:
        if self.name_type == 'first':
            return self.fake.first_name()
        elif self.name_type == 'last':
            return self.fake.last_name()
        else:
            return self.fake.name()
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

class EmailProvider(BaseDataProvider):
    """Generate realistic email addresses"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.domain_type = self.config.get('domain_type', 'random')  # random, corporate, generic
        self.use_name = self.config.get('use_name', True)
    
    def generate_single(self) -> str:
        if self.use_name:
            name = self.fake.name().lower().replace(' ', '.')
            if self.domain_type == 'corporate':
                domains = ['company.com', 'business.org', 'enterprise.net', 'corp.io']
            elif self.domain_type == 'generic':
                domains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com']
            else:
                domains = [self.fake.free_email_domain()]
            
            return f"{name}@{random.choice(domains)}"
        else:
            return self.fake.free_email()
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

class AddressProvider(BaseDataProvider):
    """Generate realistic addresses"""

    # Map common ISO country codes to valid Faker locales.
    _COUNTRY_LOCALES = {
        'US': 'en_US', 'GB': 'en_GB', 'UK': 'en_GB', 'CA': 'en_CA',
        'AU': 'en_AU', 'IN': 'en_IN', 'DE': 'de_DE', 'FR': 'fr_FR',
        'ES': 'es_ES', 'IT': 'it_IT', 'NL': 'nl_NL', 'BR': 'pt_BR',
        'PT': 'pt_PT', 'JP': 'ja_JP', 'CN': 'zh_CN', 'RU': 'ru_RU',
    }

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.address_type = self.config.get('address_type', 'full')  # full, street, city, state, zip
        self.country = self.config.get('country', 'US')
        # Resolve to a valid Faker locale. Accept either a country code
        # ("US") or a full locale ("en_US"); fall back to the default locale
        # if the value is unknown so address generation never crashes.
        locale = self._COUNTRY_LOCALES.get((self.country or '').upper(), self.country)
        try:
            self.fake = Faker(locale)
        except (AttributeError, ValueError, TypeError):
            self.fake = Faker()
    
    def generate_single(self) -> str:
        if self.address_type == 'street':
            return self.fake.street_address()
        elif self.address_type == 'city':
            return self.fake.city()
        elif self.address_type == 'state':
            return self.fake.state()
        elif self.address_type == 'zip':
            return self.fake.zipcode()
        else:
            return self.fake.address()
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

class PhoneProvider(BaseDataProvider):
    """Generate realistic phone numbers"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.phone_format = self.config.get('format', 'random')  # random, us, international
        self.country_code = self.config.get('country_code', '+1')
    
    def generate_single(self) -> str:
        if self.phone_format == 'us':
            return self.fake.phone_number()
        elif self.phone_format == 'international':
            return f"{self.country_code} {self.fake.phone_number().replace('(', '').replace(')', '').replace('-', '').replace(' ', '')}"
        else:
            return self.fake.phone_number()
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

class CompanyProvider(BaseDataProvider):
    """Generate realistic company names"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.company_type = self.config.get('company_type', 'random')  # random, tech, finance, healthcare
        self.include_suffix = self.config.get('include_suffix', True)
    
    def generate_single(self) -> str:
        if self.company_type == 'tech':
            prefixes = ['Tech', 'Digital', 'Cyber', 'Info', 'Data', 'Cloud', 'Smart', 'Quantum']
            suffixes = ['Solutions', 'Systems', 'Technologies', 'Labs', 'Innovations', 'Dynamics']
        elif self.company_type == 'finance':
            prefixes = ['Financial', 'Investment', 'Capital', 'Wealth', 'Asset', 'Global', 'Pacific']
            suffixes = ['Bank', 'Trust', 'Group', 'Partners', 'Securities', 'Advisors']
        elif self.company_type == 'healthcare':
            prefixes = ['Medical', 'Health', 'Care', 'Bio', 'Pharma', 'Medi', 'Life']
            suffixes = ['Center', 'Clinic', 'Health', 'Medical', 'Solutions', 'Labs']
        else:
            return self.fake.company()
        
        name = f"{random.choice(prefixes)} {random.choice(suffixes) if self.include_suffix else ''}"
        return name.strip()
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

class TextProvider(BaseDataProvider):
    """Generate text data"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.text_type = self.config.get('text_type', 'sentence')  # word, sentence, paragraph, text
        self.min_length = self.config.get('min_length', 5)
        self.max_length = self.config.get('max_length', 50)
    
    def generate_single(self) -> str:
        if self.text_type == 'word':
            return self.fake.word()
        elif self.text_type == 'sentence':
            return self.fake.sentence(nb_words=random.randint(self.min_length, self.max_length))
        elif self.text_type == 'paragraph':
            return self.fake.paragraph(nb_sentences=random.randint(self.min_length, self.max_length))
        else:
            return self.fake.text(max_nb_chars=random.randint(self.min_length, self.max_length))
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

class NumberProvider(BaseDataProvider):
    """Generate numeric data"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.number_type = self.config.get('number_type', 'integer')  # integer, float, decimal
        self.min_value = self.config.get('min_value', 0)
        self.max_value = self.config.get('max_value', 1000)
        self.decimal_places = self.config.get('decimal_places', 2)
    
    def generate_single(self) -> str:
        if self.number_type == 'integer':
            return str(random.randint(self.min_value, self.max_value))
        elif self.number_type == 'float':
            return str(round(random.uniform(self.min_value, self.max_value), self.decimal_places))
        elif self.number_type == 'decimal':
            return f"{random.randint(self.min_value, self.max_value)}.{random.randint(0, 99):0{self.decimal_places}d}"
        else:
            return str(random.randint(self.min_value, self.max_value))
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

class DateProvider(BaseDataProvider):
    """Generate date data"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.date_type = self.config.get('date_type', 'random')  # random, past, future, recent
        self.format = self.config.get('format', '%Y-%m-%d')
        self.start_date = self.config.get('start_date')
        self.end_date = self.config.get('end_date')
    
    def generate_single(self) -> str:
        if self.date_type == 'past':
            date = self.fake.past_date()
        elif self.date_type == 'future':
            date = self.fake.future_date()
        elif self.date_type == 'recent':
            date = self.fake.date_between(start_date='-30d', end_date='today')
        elif self.start_date and self.end_date:
            date = self.fake.date_between(start_date=self.start_date, end_date=self.end_date)
        else:
            date = self.fake.date_between(start_date='-10y', end_date='today')
        
        return date.strftime(self.format)
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

class URLProvider(BaseDataProvider):
    """Generate URL data"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.url_type = self.config.get('url_type', 'random')  # random, https, api, image
        self.domain = self.config.get('domain')
    
    def generate_single(self) -> str:
        if self.url_type == 'https':
            return self.fake.url(schemes=['https'])
        elif self.url_type == 'api':
            return f"https://api.{self.fake.domain_name()}/v1/{self.fake.word()}"
        elif self.url_type == 'image':
            return self.fake.image_url()
        elif self.domain:
            return f"https://{self.domain}/{self.fake.uri_path()}"
        else:
            return self.fake.url()
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

class UUIDProvider(BaseDataProvider):
    """Generate UUID data"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.uuid_version = self.config.get('version', 4)  # 1, 3, 4, 5
    
    def generate_single(self) -> str:
        return str(uuid.uuid4())
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

class BooleanProvider(BaseDataProvider):
    """Generate boolean data"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.true_probability = self.config.get('true_probability', 0.5)
        self.output_format = self.config.get('output_format', 'boolean')  # boolean, string, number
    
    def generate_single(self) -> str:
        value = random.random() < self.true_probability
        
        if self.output_format == 'string':
            return 'true' if value else 'false'
        elif self.output_format == 'number':
            return '1' if value else '0'
        else:
            return str(value)
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

class JSONProvider(BaseDataProvider):
    """Generate JSON data"""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(config)
        self.schema = self.config.get('schema', {})
        self.nesting_level = self.config.get('nesting_level', 2)
    
    def generate_single(self) -> str:
        return json.dumps(self._generate_object(self.nesting_level))
    
    def _generate_object(self, level: int) -> Dict[str, Any]:
        if level <= 0:
            return self.fake.word()
        
        obj = {}
        num_fields = random.randint(1, 5)
        
        for _ in range(num_fields):
            key = self.fake.word()
            field_type = random.choice(['string', 'number', 'boolean', 'object', 'array'])
            
            if field_type == 'string':
                obj[key] = self.fake.sentence()
            elif field_type == 'number':
                obj[key] = random.randint(1, 1000)
            elif field_type == 'boolean':
                obj[key] = random.choice([True, False])
            elif field_type == 'object':
                obj[key] = self._generate_object(level - 1)
            elif field_type == 'array':
                array_length = random.randint(1, 5)
                obj[key] = [self._generate_object(level - 1) for _ in range(array_length)]
        
        return obj
    
    def generate(self, count: int = 1) -> List[str]:
        return [self.generate_single() for _ in range(count)]

# Registry of data providers
DATA_PROVIDERS = {
    'name': NameProvider,
    'email': EmailProvider,
    'address': AddressProvider,
    'phone': PhoneProvider,
    'company': CompanyProvider,
    'text': TextProvider,
    'number': NumberProvider,
    'date': DateProvider,
    'url': URLProvider,
    'uuid': UUIDProvider,
    'boolean': BooleanProvider,
    'json': JSONProvider,
}

def get_provider(data_type: str, config: Optional[Dict[str, Any]] = None) -> BaseDataProvider:
    """Get data provider instance for specified data type"""
    if data_type not in DATA_PROVIDERS:
        raise ValueError(f"Unknown data type: {data_type}")
    
    return DATA_PROVIDERS[data_type](config)
