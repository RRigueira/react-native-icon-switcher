#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString *const ISIconSwitcherErrorDomain;

typedef NS_ERROR_ENUM(ISIconSwitcherErrorDomain, ISIconSwitcherErrorCode){
  ISIconSwitcherErrorCodeUnsupported = 1,
  ISIconSwitcherErrorCodeUnknownIcon = 2,
  ISIconSwitcherErrorCodeOSRejected = 3,
};

/// Injectable abstraction so `ISIconSwitcher` is testable without `UIApplication`.
@protocol ISAlternateIconProviding <NSObject>

@property (nonatomic, readonly) BOOL supportsAlternateIcons;
@property (nonatomic, readonly, nullable) NSString *alternateIconName;
- (void)setAlternateIconName:(nullable NSString *)iconName
           completionHandler:(void (^_Nullable)(NSError *_Nullable error))completionHandler;

@end

typedef void (^ISMainScheduler)(void (^block)(void));

@interface ISIconSwitcher : NSObject

@property (class, nonatomic, readonly) NSString *alternateIconPrefix;
@property (class, nonatomic, readonly) NSString *iconsPlistKey;

- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
- (instancetype)initWithProvider:(id<ISAlternateIconProviding>)provider
                          bundle:(NSBundle *)bundle
                  scheduleOnMain:(ISMainScheduler)scheduleOnMain NS_DESIGNATED_INITIALIZER;
+ (instancetype)defaultSwitcher;

@property (nonatomic, readonly, copy) NSArray<NSString *> *iconNames;
@property (nonatomic, readonly) BOOL isSupported;

- (NSString *)currentIconName;
- (void)setIconName:(NSString *)name
         completion:(void (^)(NSError *_Nullable error))completion;

+ (NSString *)iconNameFromAlternateIconName:(nullable NSString *)alternate;
+ (nullable NSString *)alternateIconNameFromIconName:(NSString *)name;

@end

NS_ASSUME_NONNULL_END
