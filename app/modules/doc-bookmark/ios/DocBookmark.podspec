Pod::Spec.new do |s|
  s.name           = 'DocBookmark'
  s.version        = '1.0.0'
  s.summary        = 'Resolve iOS security-scoped bookmarks back to accessible file URLs'
  s.description    = 'Morpho local module: restores long-term access to externally opened files after app termination.'
  s.author         = 'Morpho'
  s.homepage       = 'https://github.com/c-colloid/Morpho'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/c-colloid/Morpho.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
end
