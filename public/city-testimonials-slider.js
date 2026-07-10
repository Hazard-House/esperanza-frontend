document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.city-page-testimonials-slider').forEach(function (el) {
    if (el.swiper) {
      el.swiper.destroy(true, true);
    }

    new Swiper(el, {
      slidesPerView: 1,
      slidesPerGroup: 1,
      spaceBetween: 16,
      watchOverflow: false,
      roundLengths: true,
      observer: true,
      observeParents: true,
      navigation: {
        nextEl: el.querySelector('.testimonials-next'),
        prevEl: el.querySelector('.testimonials-prev'),
      },
      breakpoints: {
        768: {
          slidesPerView: 2,
          spaceBetween: 16,
        },
        1400: {
          slidesPerView: 3,
          spaceBetween: 20,
        },
      },
      keyboard: {
        enabled: true,
      },
      a11y: {
        prevSlideMessage: 'Previous testimonial',
        nextSlideMessage: 'Next testimonial',
      },
    });
  });
});
