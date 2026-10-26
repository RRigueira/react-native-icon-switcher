#import "ISIconSwitcher.h"

#import <UIKit/UIKit.h>

NSString *const ISIconSwitcherErrorDomain = @"com.iconswitcher.IconSwitcher";

@interface ISUIApplicationAlternateIconProvider : NSObject <ISAlternateIconProviding>
@end

@implementation ISUIApplicationAlternateIconProvider

+ (instancetype)shared
{
  static ISUIApplicationAlternateIconProvider *instance;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [ISUIApplicationAlternateIconProvider new];
  });
  return instance;
}

- (BOOL)supportsAlternateIcons
{
  return UIApplication.sharedApplication.supportsAlternateIcons;
}

- (NSString *)alternateIconName
{
  return UIApplication.sharedApplication.alternateIconName;
}

- (void)setAlternateIconName:(NSString *)iconName
           completionHandler:(void (^)(NSError *_Nullable))completionHandler
{
  [UIApplication.sharedApplication setAlternateIconName:iconName
                                      completionHandler:completionHandler];
}

@end

static id _runOnMain(id (^work)(void))
{
  if ([NSThread isMainThread]) {
    return work();
  }
  __block id result;
  dispatch_sync(dispatch_get_main_queue(), ^{
    result = work();
  });
  return result;
}

@implementation ISIconSwitcher {
  id<ISAlternateIconProviding> _provider;
  NSBundle *_bundle;
  ISMainScheduler _scheduleOnMain;
}

+ (NSString *)alternateIconPrefix
{
  return @"AppIcon-";
}

+ (NSString *)iconsPlistKey
{
  return @"IconSwitcherIcons";
}

- (instancetype)initWithProvider:(id<ISAlternateIconProviding>)provider
                          bundle:(NSBundle *)bundle
                  scheduleOnMain:(ISMainScheduler)scheduleOnMain
{
  if (self = [super init]) {
    _provider = provider;
    _bundle = bundle;
    _scheduleOnMain = [scheduleOnMain copy];
  }
  return self;
}

+ (instancetype)defaultSwitcher
{
  return [[self alloc] initWithProvider:[ISUIApplicationAlternateIconProvider shared]
                                 bundle:NSBundle.mainBundle
                         scheduleOnMain:^(void (^block)(void)) {
                           dispatch_async(dispatch_get_main_queue(), block);
                         }];
}

- (NSArray<NSString *> *)iconNames
{
  id raw = [_bundle objectForInfoDictionaryKey:self.class.iconsPlistKey];
  if ([raw isKindOfClass:[NSArray class]]) {
    NSArray *names = (NSArray *)raw;
    if (names.count > 0) {
      return names;
    }
  }
  return @[ @"default" ];
}

- (BOOL)isSupported
{
  return [_runOnMain(^{
    return @(_provider.supportsAlternateIcons);
  }) boolValue];
}

- (NSString *)currentIconName
{
  return [_runOnMain(^{
    return [self.class iconNameFromAlternateIconName:_provider.alternateIconName];
  }) copy];
}

- (void)setIconName:(NSString *)name completion:(void (^)(NSError *_Nullable))completion
{
  if (![_runOnMain(^{
        return @(_provider.supportsAlternateIcons);
      }) boolValue]) {
    completion([NSError errorWithDomain:ISIconSwitcherErrorDomain
                                   code:ISIconSwitcherErrorCodeUnsupported
                               userInfo:@{
                                 NSLocalizedDescriptionKey :
                                     @"Alternate app icons are not supported on this device.",
                               }]);
    return;
  }

  if (![self.iconNames containsObject:name]) {
    completion([NSError errorWithDomain:ISIconSwitcherErrorDomain
                                   code:ISIconSwitcherErrorCodeUnknownIcon
                               userInfo:@{
                                 NSLocalizedDescriptionKey :
                                     @"The requested icon name is not bundled in this app.",
                               }]);
    return;
  }

  if ([[self currentIconName] isEqualToString:name]) {
    completion(nil);
    return;
  }

  NSString *targetAlternate = [self.class alternateIconNameFromIconName:name];
  ISMainScheduler scheduleOnMain = _scheduleOnMain;
  id<ISAlternateIconProviding> provider = _provider;
  // The provider holds the completion block until UIKit calls it, so the read-back must not
  // capture it strongly.
  __weak id<ISAlternateIconProviding> weakProvider = provider;

  scheduleOnMain(^{
    [provider setAlternateIconName:targetAlternate
                 completionHandler:^(NSError *_Nullable error) {
                   scheduleOnMain(^{
                      if (error != nil) {
                        completion([NSError errorWithDomain:ISIconSwitcherErrorDomain
                                                       code:ISIconSwitcherErrorCodeOSRejected
                                                   userInfo:@{
                                                     NSLocalizedDescriptionKey : error.localizedDescription,
                                                   }]);
                        return;
                      }

                      NSString *actualAlternate = weakProvider.alternateIconName;
                      BOOL matches = (targetAlternate == nil && actualAlternate == nil) ||
                                       [actualAlternate isEqualToString:targetAlternate];
                      if (!matches) {
                        completion([NSError
                            errorWithDomain:ISIconSwitcherErrorDomain
                                       code:ISIconSwitcherErrorCodeOSRejected
                                   userInfo:@{
                                     NSLocalizedDescriptionKey :
                                         @"Alternate icon name mismatch after apply",
                                   }]);
                        return;
                      }

                      completion(nil);
                    });
                  }];
  });
}

+ (NSString *)iconNameFromAlternateIconName:(NSString *)alternate
{
  if (alternate == nil) {
    return @"default";
  }
  NSString *prefix = self.alternateIconPrefix;
  if ([alternate hasPrefix:prefix]) {
    return [alternate substringFromIndex:prefix.length];
  }
  return alternate;
}

+ (NSString *)alternateIconNameFromIconName:(NSString *)name
{
  if ([name isEqualToString:@"default"]) {
    return nil;
  }
  return [self.alternateIconPrefix stringByAppendingString:name];
}

@end
